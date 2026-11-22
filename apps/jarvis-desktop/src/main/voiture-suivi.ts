/**
 * Suivi de la voiture via un traceur GPS OBD, sans dépendre des services du
 * constructeur. Idéal pour une voiture ancienne (ex. Peugeot 107) : un petit
 * boîtier se branche sur la prise OBD et envoie sa position à un serveur
 * **Traccar** (open-source, gratuit, qui tourne chez toi). Jarvis lit l'API REST
 * de ce serveur et peut dire : où est la voiture, si elle a bougé, la tension de
 * la batterie, le kilométrage. Rien ne passe par un cloud qu'on ne maîtrise pas.
 *
 * Traccar accepte des centaines de modèles de traceurs bon marché, ce qui évite
 * de dépendre d'une appli propriétaire.
 */

export interface TraccarDevice {
  id: number;
  name: string;
  uniqueId?: string;
  status?: string;
  lastUpdate?: string;
}

export interface TraccarPosition {
  deviceId: number;
  latitude: number;
  longitude: number;
  speed?: number; // nœuds (unité Traccar)
  address?: string;
  deviceTime?: string;
  fixTime?: string;
  attributes?: Record<string, unknown>;
}

export interface EtatVoiture {
  nom: string;
  enLigne: boolean;
  enMouvement: boolean;
  vitesseKmh: number;
  adresse?: string;
  lat?: number;
  lon?: number;
  /** Tension batterie (V), si le traceur la remonte. */
  tension?: number;
  /** Kilométrage total (km), si disponible. */
  km?: number;
  maj?: string;
}

const NOEUD_EN_KMH = 1.852;

function nombre(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** La position la plus récente d'un appareil donné (ou la plus récente tout court). */
export function choisirPosition(positions: TraccarPosition[], deviceId?: number): TraccarPosition | undefined {
  const pool = deviceId ? positions.filter((p) => p.deviceId === deviceId) : positions;
  return [...pool].sort((a, b) => Date.parse(b.fixTime ?? b.deviceTime ?? "") - Date.parse(a.fixTime ?? a.deviceTime ?? ""))[0];
}

/** Construit un état lisible à partir d'un appareil et de sa position. Fonction pure. */
export function etatVoiture(device: TraccarDevice, position: TraccarPosition | undefined, now = new Date()): EtatVoiture {
  const attr = position?.attributes ?? {};
  const vitesseKmh = Math.round((position?.speed ?? 0) * NOEUD_EN_KMH);
  const motion = attr.motion;
  const enMouvement = motion === true || (typeof motion !== "boolean" && vitesseKmh > 3);
  const maj = position?.fixTime ?? position?.deviceTime ?? device.lastUpdate;
  const recent = maj ? now.getTime() - Date.parse(maj) < 15 * 60_000 : false;
  const km = nombre(attr.odometer) ?? nombre(attr.totalDistance);
  return {
    nom: device.name,
    enLigne: device.status === "online" || recent,
    enMouvement,
    vitesseKmh,
    ...(position?.address ? { adresse: position.address } : {}),
    ...(position ? { lat: Math.round(position.latitude * 1e5) / 1e5, lon: Math.round(position.longitude * 1e5) / 1e5 } : {}),
    ...(nombre(attr.power) !== undefined ? { tension: Math.round(nombre(attr.power)! * 10) / 10 } : nombre(attr.battery) !== undefined ? { tension: Math.round(nombre(attr.battery)! * 10) / 10 } : {}),
    ...(km !== undefined ? { km: Math.round(km / 1000) } : {}),
    ...(maj ? { maj } : {}),
  };
}

const quand = (iso?: string): string => {
  if (!iso) return "position inconnue";
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  if (min < 2) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  if (min < 48 * 60) return `il y a ${Math.round(min / 60)} h`;
  return d.toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

/** Phrase courte pour la voix, le point du matin ou Claude. */
export function phraseVoiture(e: EtatVoiture): string {
  const bits: string[] = [];
  if (e.enMouvement) bits.push(`${e.nom} roule à ${e.vitesseKmh} km/h`);
  else bits.push(`${e.nom} est à l'arrêt`);
  if (e.adresse) bits.push(e.adresse);
  else if (e.lat !== undefined) bits.push(`${e.lat}, ${e.lon}`);
  bits.push(`position ${quand(e.maj)}`);
  if (e.tension !== undefined) bits.push(`batterie ${e.tension} V${e.tension < 12 ? " (faible)" : ""}`);
  if (e.km !== undefined) bits.push(`${e.km} km au compteur`);
  if (!e.enLigne) bits.push("le traceur est hors ligne pour le moment");
  return bits.join(" · ") + ".";
}

export interface SuiviDeps {
  /** URL de base du serveur Traccar, ex. http://192.168.1.50:8082 */
  url: string;
  /** Jeton d'API Traccar (en-tête Authorization: Bearer). */
  token?: string;
  /** Ou e-mail + mot de passe (authentification Basic). */
  email?: string;
  motDePasse?: string;
  /** Nom de l'appareil à suivre (sinon le premier/seul). */
  appareil?: string;
  fetch?: typeof fetch;
}

/** Client minimal du serveur Traccar : lit les appareils et leurs positions. */
export class SuiviVoiture {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly deps: SuiviDeps) {
    this.base = deps.url.replace(/\/+$/, "");
    this.doFetch = deps.fetch ?? fetch;
  }

  private headers(): Record<string, string> {
    if (this.deps.token) return { Authorization: `Bearer ${this.deps.token}` };
    if (this.deps.email && this.deps.motDePasse)
      return { Authorization: `Basic ${Buffer.from(`${this.deps.email}:${this.deps.motDePasse}`).toString("base64")}` };
    return {};
  }

  private async get<T>(chemin: string): Promise<T> {
    const res = await this.doFetch(`${this.base}${chemin}`, { headers: { Accept: "application/json", ...this.headers() } });
    if (!res.ok) throw new Error(res.status === 401 ? "Identifiants Traccar refusés (vérifie le jeton ou l'e-mail/mot de passe)." : `Traccar a répondu ${res.status}.`);
    return (await res.json()) as T;
  }

  async devices(): Promise<TraccarDevice[]> {
    return this.get<TraccarDevice[]>("/api/devices");
  }

  async positions(): Promise<TraccarPosition[]> {
    return this.get<TraccarPosition[]>("/api/positions");
  }

  /** État de la voiture suivie, prêt à lire. */
  async etat(now = new Date()): Promise<EtatVoiture> {
    const devices = await this.devices();
    if (devices.length === 0) throw new Error("Aucun traceur n'est déclaré dans Traccar.");
    const device = this.deps.appareil
      ? devices.find((d) => d.name.toLowerCase().includes(this.deps.appareil!.toLowerCase())) ?? devices[0]!
      : devices[0]!;
    const position = choisirPosition(await this.positions(), device.id);
    return etatVoiture(device, position, now);
  }

  async phrase(now = new Date()): Promise<string> {
    try {
      return phraseVoiture(await this.etat(now));
    } catch (error) {
      return error instanceof Error ? error.message : "Suivi de la voiture indisponible.";
    }
  }
}
