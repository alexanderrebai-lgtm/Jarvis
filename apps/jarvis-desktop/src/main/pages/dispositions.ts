import { JsonStore } from "@muscu/jarvis/src/store.js";
import { normalize, PAGES, type PageId, type ScreenName } from "./catalog.js";
import type { Placement } from "./layout.js";

/**
 * Dispositions : des ensembles de pages qui s'ouvrent ensemble, chacune à sa
 * place (« mode course » = Ingénieur à gauche, Performances à droite). Alex peut
 * les modifier et en créer, jusqu'à trois pages (une par écran, ou en tiers sur
 * un seul écran).
 */

export interface Disposition {
  id: string;
  nom: string;
  /** Autres façons de la nommer à l'oral. */
  mots: string[];
  pages: Placement[];
}

export const DEFAULT_DISPOSITIONS: Disposition[] = [
  { id: "course", nom: "Course", mots: ["course", "simu", "pilotage", "stand"], pages: [{ page: "ingenieur", ecran: "gauche" }, { page: "performances", ecran: "droite" }] },
  { id: "atelier", nom: "Atelier", mots: ["atelier", "developpement", "dev", "labo"], pages: [{ page: "code", ecran: "gauche" }, { page: "rd", ecran: "droite" }] },
  { id: "bureau", nom: "Bureau", mots: ["bureau", "travail", "boulot"], pages: [{ page: "travail", ecran: "gauche" }, { page: "accueil", ecran: "droite" }] },
];

export function slug(text: string): string {
  return normalize(text).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "disposition";
}

const VALID_PAGES = new Set<string>(PAGES.map((p) => p.id));
const VALID_SCREENS = new Set<string>(["gauche", "centre", "droite"]);

export function validateDisposition(input: { nom: string; pages: Array<{ page: string; ecran: string }>; mots?: string[] }): Disposition {
  const nom = input.nom.trim();
  if (!nom) throw new Error("Donne un nom à la disposition.");
  if (input.pages.length === 0 || input.pages.length > 3) throw new Error("Une disposition contient une à trois pages.");
  const seen = new Set<string>();
  const pages = input.pages.map((p) => {
    if (!VALID_PAGES.has(p.page)) throw new Error(`Page inconnue : ${p.page}`);
    if (!VALID_SCREENS.has(p.ecran)) throw new Error(`Emplacement inconnu : ${p.ecran} (gauche, centre ou droite)`);
    if (seen.has(p.page)) throw new Error(`La page ${p.page} apparaît deux fois.`);
    seen.add(p.page);
    return { page: p.page as PageId, ecran: p.ecran as ScreenName };
  });
  const mots = [...new Set([normalize(nom), ...(input.mots ?? []).map(normalize)].filter(Boolean))];
  return { id: slug(nom), nom, mots, pages };
}

export class DispositionStore {
  private readonly store: JsonStore<Disposition[]>;

  constructor(dataDir: string) {
    this.store = new JsonStore(dataDir, "dispositions", () => DEFAULT_DISPOSITIONS.map((d) => ({ ...d, pages: [...d.pages], mots: [...d.mots] })));
  }

  list(): Disposition[] {
    return this.store.read();
  }

  get(name: string): Disposition | undefined {
    const n = normalize(name);
    const id = slug(name);
    return this.list().find((d) => d.id === id || normalize(d.nom) === n || d.mots.includes(n));
  }

  /** Crée ou remplace une disposition du même nom. */
  save(input: { nom: string; pages: Array<{ page: string; ecran: string }>; mots?: string[] }): Disposition {
    const disposition = validateDisposition(input);
    this.store.update((all) => [...all.filter((d) => d.id !== disposition.id), disposition]);
    return disposition;
  }

  remove(name: string): boolean {
    const found = this.get(name);
    if (!found) return false;
    this.store.update((all) => all.filter((d) => d.id !== found.id));
    return true;
  }
}

export type DispositionCommand =
  | { action: "appliquer"; nom: string }
  | { action: "enregistrer"; nom: string }
  | { action: "echanger" };

/**
 * « Mode atelier », « passe en disposition course », « garde cette disposition
 * sous le nom soirée », « échange les écrans ». Les noms inconnus ne sont pas
 * reconnus (la phrase part vers Claude ou vers les commandes de pages).
 */
export function parseDispositionCommand(sentence: string, known: Disposition[]): DispositionCommand | undefined {
  const text = normalize(sentence);
  if (/^(echange|inverse|permute|intervertis)\b.*\b(ecrans?|pages?|cote|places?|gauche et droite)\b/.test(text) || /^(echange|inverse|permute)$/.test(text)) return { action: "echanger" };
  const save = text.match(/^(garde|enregistre|sauvegarde|memorise|retiens)\b.*\b(disposition|dispo|configuration|config)\b.*\b(sous le nom|nom|appelee?|comme)\s+(.+)$/);
  if (save) return { action: "enregistrer", nom: save[4]!.trim() };
  const apply = text.match(/^(?:(?:passe|mets|met|active|lance|ouvre|affiche|charge)\s+)?(?:en\s+|la\s+|le\s+|sur\s+)*(?:mode|disposition|dispo|configuration|config)\s+(.+)$/);
  if (!apply) return undefined;
  const name = apply[1]!.replace(/^(de |d |du |la |le )/, "").trim();
  const found = known.find((d) => normalize(d.nom) === name || d.mots.includes(name) || d.id === slug(name));
  return found ? { action: "appliquer", nom: found.nom } : undefined;
}
