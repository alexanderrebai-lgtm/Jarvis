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

export class TapoHome {
  private devices: TapoEntry[] | undefined;
  private discoveredAt = 0;
  private readonly connections = new Map<string, TapoConnection>();

  constructor(private readonly driver: TapoDriver, private readonly now: () => number = Date.now) {}

  private async entries(): Promise<TapoEntry[]> {
    if (!this.devices || this.now() - this.discoveredAt > 10 * 60_000) {
      const devices = await this.driver.discover();
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
    }
    return this.devices;
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
