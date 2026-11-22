import { JsonStore, newId } from "@muscu/jarvis/src/store.js";

/**
 * Briefings programmés : Jarvis fait une recherche à heure fixe (« chaque lundi
 * à 8 h, l'actualité des simulateurs de course ») et t'envoie le résumé à voix
 * haute et/ou sur Telegram. Réutilise le cerveau (recherche web) et les alertes
 * téléphone. Rien ne part tant que tu n'as pas créé le briefing.
 */

export type Canal = "voix" | "telegram";
/** lun…dim, ou vide = tous les jours. */
export type Jour = "lun" | "mar" | "mer" | "jeu" | "ven" | "sam" | "dim";

export interface Briefing {
  id: string;
  sujet: string;
  /** « HH:MM » (heure locale). */
  heure: string;
  jours: Jour[];
  canaux: Canal[];
  actif: boolean;
  creeLe: string;
  /** Date (AAAA-MM-JJ) du dernier envoi, pour n'envoyer qu'une fois par jour. */
  dernierEnvoi?: string;
}

export interface BriefingInput {
  sujet: string;
  heure: string;
  jours?: Jour[];
  canaux?: Canal[];
}

const JOURS: Jour[] = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
const JOUR_LABEL: Record<Jour, string> = { lun: "lundi", mar: "mardi", mer: "mercredi", jeu: "jeudi", ven: "vendredi", sam: "samedi", dim: "dimanche" };

/** « HH:MM » valide → normalisé, sinon undefined. */
export function parseHeure(raw: string): string | undefined {
  const m = raw.trim().match(/^(\d{1,2})\s*[:hH]\s*(\d{0,2})$/);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function describeBriefing(b: Briefing): string {
  const quand = b.jours.length === 0 || b.jours.length === 7 ? "chaque jour" : `les ${b.jours.map((j) => JOUR_LABEL[j]).join(", ")}`;
  return `${quand} à ${b.heure.replace(":", " h ")} : ${b.sujet} (${b.canaux.join(" et ")})`;
}

/**
 * Faut-il lancer ce briefing maintenant ? Fonction pure (testable).
 * - « lancer » : c'est l'heure (ou peu après), le bon jour, pas déjà fait aujourd'hui ;
 * - « rattrapage-tardif » : l'heure est passée de plus de la fenêtre (PC éteint le matin) : on marque fait sans envoyer la nuit ;
 * - « attendre » : sinon.
 */
export function briefingDue(b: Briefing, now: Date, fenetreMinutes = 180): "lancer" | "rattrapage-tardif" | "attendre" {
  if (!b.actif) return "attendre";
  const jour = JOURS[now.getDay()]!;
  if (b.jours.length > 0 && b.jours.length < 7 && !b.jours.includes(jour)) return "attendre";
  const today = toISODate(now);
  if (b.dernierEnvoi === today) return "attendre";
  const [h, min] = b.heure.split(":").map(Number) as [number, number];
  const prevu = h * 60 + min;
  const maintenant = now.getHours() * 60 + now.getMinutes();
  if (maintenant < prevu) return "attendre";
  return maintenant - prevu <= fenetreMinutes ? "lancer" : "rattrapage-tardif";
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export class BriefingStore {
  private readonly store: JsonStore<Briefing[]>;

  constructor(dataDir: string) {
    this.store = new JsonStore(dataDir, "briefings", () => []);
  }

  list(): Briefing[] {
    return this.store.read();
  }

  add(input: BriefingInput): Briefing {
    const sujet = input.sujet.trim();
    if (!sujet) throw new Error("Donne un sujet au briefing (ex. « l'actualité des simulateurs de course »).");
    const heure = parseHeure(input.heure);
    if (!heure) throw new Error("Donne une heure valide, par exemple 08:00.");
    const jours = (input.jours ?? []).filter((j) => JOURS.includes(j));
    const canaux = (input.canaux ?? ["voix"]).filter((c) => c === "voix" || c === "telegram");
    const briefing: Briefing = { id: newId("brief"), sujet, heure, jours, canaux: canaux.length ? canaux : ["voix"], actif: true, creeLe: new Date().toISOString() };
    this.store.update((all) => [...all, briefing]);
    return briefing;
  }

  setActive(id: string, actif: boolean): boolean {
    let found = false;
    this.store.update((all) => all.map((b) => (b.id === id ? ((found = true), { ...b, actif }) : b)));
    return found;
  }

  markSent(id: string, date: string): void {
    this.store.update((all) => all.map((b) => (b.id === id ? { ...b, dernierEnvoi: date } : b)));
  }

  remove(id: string): boolean {
    const before = this.store.read().length;
    return this.store.update((all) => all.filter((b) => b.id !== id)).length < before;
  }
}
