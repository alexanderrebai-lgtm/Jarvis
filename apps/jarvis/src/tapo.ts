import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cloudLogin, loginDevice, loginDeviceByIp, type TapoDevice } from "tp-link-tapo-connect";

/**
 * Ampoules et prises TP-Link Tapo, pilotées directement sur le Wi-Fi de la maison
 * (sans Home Assistant). Jarvis doit donc tourner chez toi, sur le même réseau.
 *
 * Les appareils sont trouvés grâce à ton compte Tapo, ou listés à la main avec
 * leur adresse IP dans TAPO_DEVICES (plus fiable : « Salon=192.168.1.20,Bureau=192.168.1.21 »).
 */

export type TapoKind = "ampoule" | "prise" | "autre";

export interface TapoEntry {
  nom: string;
  type: TapoKind;
  modele: string;
  ip?: string;
  cloud?: TapoDevice;
}

export interface TapoState {
  nom: string;
  type: TapoKind;
  modele: string;
  allume: boolean | null;
  luminosite?: number;
  consommationAujourdhuiWh?: number;
  puissanceW?: number;
  erreur?: string;
}

/** Ce que Jarvis utilise d'un appareil connecté (sous-ensemble de la bibliothèque). */
export interface TapoConnection {
  turnOn: () => Promise<void>;
  turnOff: () => Promise<void>;
  setBrightness: (level: number) => Promise<void>;
  setColour: (colour: string) => Promise<void>;
  getDeviceInfo: () => Promise<Record<string, unknown>>;
  getEnergyUsage: () => Promise<Record<string, unknown>>;
}

export interface TapoDriver {
  discover: () => Promise<TapoEntry[]>;
  connect: (entry: TapoEntry) => Promise<TapoConnection>;
}

function kindOf(deviceType: string, model: string): TapoKind {
  const text = `${deviceType} ${model}`.toUpperCase();
  if (text.includes("BULB") || /\bL\d{3}/.test(text)) return "ampoule";
  if (text.includes("PLUG") || /\bP\d{3}/.test(text)) return "prise";
  return "autre";
}

/** TP-Link encode les noms en base64 ; on décode seulement si le résultat est lisible. */
export function decodeAlias(alias: string): string {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(alias) || alias.length % 4 !== 0) return alias;
  const decoded = Buffer.from(alias, "base64").toString("utf8");
  return /^[\p{L}\p{N}\p{P}\p{Zs}]+$/u.test(decoded) ? decoded : alias;
}

export function parseDeviceList(raw: string | undefined): TapoEntry[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [nom, ip] = part.split("=").map((s) => s.trim());
      if (!nom || !ip) throw new Error(`TAPO_DEVICES mal écrit près de « ${part} » (attendu Nom=IP).`);
      return { nom, ip, type: "autre" as TapoKind, modele: "" };
    });
}

/** Pilote réel : compte TP-Link pour découvrir, protocole local pour commander. */
export function realTapoDriver(email: string, password: string, manual: TapoEntry[]): TapoDriver {
  return {
    discover: async () => {
      if (manual.length) return manual;
      const cloud = await cloudLogin(email, password);
      const devices = await cloud.listDevices();
      return devices
        .filter((d) => d.deviceType.toUpperCase().includes("SMART.TAPO"))
        .map((d) => ({ nom: decodeAlias(d.alias), type: kindOf(d.deviceType, d.deviceModel), modele: d.deviceModel, cloud: d }));
    },
    connect: async (entry) => {
      const device = entry.ip ? await loginDeviceByIp(email, password, entry.ip) : await loginDevice(email, password, entry.cloud!);
      return device as unknown as TapoConnection;
    },
  };
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type TapoAction = "allumer" | "eteindre";

/** Erreurs du compte TP-Link expliquées en français. */
export function explainTapoError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/-20661|locked/i.test(text)) return "TP-Link a verrouillé ton compte pour un moment, après trop de connexions. Ne réessaie pas tout de suite : attends environ une heure (chaque essai prolonge le blocage). Jarvis garde maintenant la liste de tes appareils et ne se connecte plus au compte qu'une fois par jour.";
  if (/-20601|-20600|incorrect|password/i.test(text)) return "TP-Link refuse l'e-mail ou le mot de passe : vérifie-les dans l'appli Tapo (ce sont ceux de ton compte TP-Link).";
  if (/-20004|-20675|too many|frequent/i.test(text)) return "TP-Link demande d'attendre un peu avant de se reconnecter. Réessaie dans une heure.";
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|fetch failed|getaddrinfo/i.test(text)) return "Le serveur TP-Link ne répond pas : vérifie la connexion Internet.";
  return text;
}

export interface TapoHomeOptions {
  now?: () => number;
  /** Fichier où garder la liste des appareils (pas besoin du compte TP-Link à chaque démarrage). */
  cacheFile?: string;
  /** Compte auquel la liste appartient (un autre compte ignore la liste gardée). */
  cacheKey?: string;
  /** Liste rafraîchie au plus une fois par… (24 h par défaut). */
  rediscoverMs?: number;
  /** Après un échec de connexion au compte, pas de nouvel essai avant… (1 h par défaut). */
  backoffMs?: number;
}

export class TapoHome {
  private devices: TapoEntry[] | undefined;
  private discoveredAt = 0;
  private failedAt: number | undefined;
  private lastError: string | undefined;
  private readonly connections = new Map<string, TapoConnection>();
  private readonly now: () => number;

  constructor(private readonly driver: TapoDriver, private readonly options: TapoHomeOptions = {}) {
    this.now = options.now ?? Date.now;
    this.loadCache();
  }

  private loadCache(): void {
    const file = this.options.cacheFile;
    if (!file || !existsSync(file)) return;
    try {
      const saved = JSON.parse(readFileSync(file, "utf8")) as { cle?: string; date: number; appareils: TapoEntry[]; echec?: number; erreur?: string };
      if (saved.cle !== this.options.cacheKey) return;
      if (Array.isArray(saved.appareils) && saved.appareils.length) {
        this.devices = saved.appareils;
        this.discoveredAt = saved.date;
      }
      if (saved.echec !== undefined) {
        this.failedAt = saved.echec;
        this.lastError = saved.erreur;
      }
    } catch {
      // liste illisible : on la refera
    }
  }

  private saveCache(): void {
    const file = this.options.cacheFile;
    if (!file) return;
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ cle: this.options.cacheKey, date: this.discoveredAt, appareils: this.devices ?? [], echec: this.failedAt, erreur: this.lastError }));
    } catch {
      // pas grave : la liste sera refaite au prochain démarrage
    }
  }

  /** Connaît-on déjà des appareils (sans se connecter au compte) ? */
  get known(): number {
    return this.devices?.length ?? 0;
  }

  /** Relit la liste des appareils sur le compte TP-Link (bouton « Tester »), sauf pendant un blocage. */
  async refresh(): Promise<void> {
    this.discoveredAt = 0;
    await this.entries();
  }

  private async entries(): Promise<TapoEntry[]> {
    const fresh = this.devices && this.now() - this.discoveredAt < (this.options.rediscoverMs ?? 24 * 3_600_000);
    if (!fresh) {
      // Après un échec (compte verrouillé, mot de passe refusé), on ne réessaie pas en boucle : TP-Link prolongerait le blocage.
      if (this.failedAt !== undefined && this.now() - this.failedAt < (this.options.backoffMs ?? 3_600_000)) {
        if (this.devices) return this.devices;
        throw new Error(this.lastError ?? "Compte TP-Link indisponible pour le moment.");
      }
      let devices: TapoEntry[];
      try {
        devices = await this.driver.discover();
      } catch (error) {
        this.failedAt = this.now();
        this.lastError = explainTapoError(error);
        this.saveCache();
        if (this.devices) return this.devices;
        throw new Error(this.lastError);
      }
      this.failedAt = undefined;
      this.lastError = undefined;
      this.devices = devices;
      this.discoveredAt = this.now();
      // Liste manuelle : on demande à chaque appareil s'il est ampoule ou prise.
      await Promise.all(
        devices
          .filter((d) => d.type === "autre")
          .map(async (d) => {
            const info = await this.withDevice(d, (device) => device.getDeviceInfo()).catch(() => undefined);
            if (!info) return;
            d.modele = String(info.model ?? d.modele);
            d.type = kindOf(String(info.type ?? ""), d.modele);
          }),
      );
      this.saveCache();
    }
    return this.devices!;
  }

  private async connection(entry: TapoEntry): Promise<TapoConnection> {
    const cached = this.connections.get(entry.nom);
    if (cached) return cached;
    const created = await this.driver.connect(entry);
    this.connections.set(entry.nom, created);
    return created;
  }

  /** Exécute une opération ; si la session a expiré, se reconnecte une fois. */
  private async withDevice<T>(entry: TapoEntry, task: (device: TapoConnection) => Promise<T>): Promise<T> {
    try {
      return await task(await this.connection(entry));
    } catch {
      this.connections.delete(entry.nom);
      return task(await this.connection(entry));
    }
  }

  /** Trouve les appareils visés : « salon », « toutes les lumières », « tout »… */
  async match(target: string): Promise<TapoEntry[]> {
    const all = await this.entries();
    const wanted = normalize(target);
    if (/^(tout|toutes?|tous|partout|la maison)( |$)/.test(wanted) || wanted === "*") {
      if (/(lumiere|lampe|ampoule)/.test(wanted)) return all.filter((d) => d.type === "ampoule");
      if (/prise/.test(wanted)) return all.filter((d) => d.type === "prise");
      return all;
    }
    const exact = all.filter((d) => normalize(d.nom) === wanted);
    if (exact.length) return exact;
    const words = wanted.split(" ").filter((w) => w.length > 1);
    return all.filter((d) => {
      const name = normalize(d.nom);
      return words.length > 0 && words.every((w) => name.includes(w));
    });
  }

  async states(withEnergy = false): Promise<TapoState[]> {
    const all = await this.entries();
    return Promise.all(
      all.map(async (entry): Promise<TapoState> => {
        const base = { nom: entry.nom, type: entry.type, modele: entry.modele };
        try {
          return await this.withDevice(entry, async (device) => {
            const info = await device.getDeviceInfo();
            const model = String(info.model ?? entry.modele);
            const type = entry.type === "autre" ? kindOf(String(info.type ?? ""), model) : entry.type;
            const state: TapoState = { ...base, type, modele: model, allume: Boolean(info.device_on) };
            if (typeof info.brightness === "number" && type === "ampoule") state.luminosite = info.brightness;
            if (withEnergy && type === "prise") {
              const energy = await device.getEnergyUsage().catch(() => undefined);
              if (energy && typeof energy.today_energy === "number") state.consommationAujourdhuiWh = energy.today_energy;
              if (energy && typeof energy.current_power === "number") state.puissanceW = energy.current_power / 1000;
            }
            return state;
          });
        } catch (error) {
          return { ...base, allume: null, erreur: `injoignable (${error instanceof Error ? error.message : String(error)})` };
        }
      }),
    );
  }

  async command(target: string, options: { action?: TapoAction; luminosite?: number; couleur?: string }): Promise<Array<{ nom: string; ok: boolean; erreur?: string }>> {
    const targets = await this.match(target);
    if (targets.length === 0) {
      const names = (await this.entries()).map((d) => d.nom).join(", ");
      throw new Error(`Aucun appareil Tapo ne correspond à « ${target} ». Appareils connus : ${names || "aucun"}.`);
    }
    return Promise.all(
      targets.map(async (entry) => {
        try {
          await this.withDevice(entry, async (device) => {
            const lightSettings = options.luminosite !== undefined || options.couleur !== undefined;
            if (lightSettings && entry.type === "prise") throw new Error("une prise n'a ni luminosité ni couleur");
            if (options.action === "eteindre") return device.turnOff();
            if (options.action === "allumer" || lightSettings) await device.turnOn();
            if (options.luminosite !== undefined) await device.setBrightness(Math.min(100, Math.max(1, Math.round(options.luminosite))));
            if (options.couleur !== undefined) await device.setColour(options.couleur);
          });
          return { nom: entry.nom, ok: true };
        } catch (error) {
          return { nom: entry.nom, ok: false, erreur: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
  }
}
