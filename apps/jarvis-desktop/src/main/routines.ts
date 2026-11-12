import { JsonStore, newId } from "@muscu/jarvis/src/store.js";

/**
 * Routines et minuteurs. Une routine enchaîne des actions sur une phrase
 * (« bonne nuit » : lumières éteintes, ne pas déranger, résumé de demain) ;
 * Alex peut les modifier et en créer à la voix. Les minuteurs survivent à un
 * redémarrage.
 */

export type RoutineStep =
  | { type: "lumieres"; cible: string; action?: "allumer" | "eteindre"; luminosite?: number; couleur?: string }
  | { type: "surveillance"; mode: "complete" | "simple" | "off" }
  | { type: "disposition"; nom: string }
  | { type: "pages"; action: "fermer_tout" }
  | { type: "dire"; texte: string }
  | { type: "ne_pas_deranger"; actif: boolean }
  | { type: "musique"; action: "lecture" | "pause" | "reveil"; requete?: string }
  | { type: "resume"; quoi: "demain" | "journee" | "absence" }
  | { type: "ecrans_veille" }
  | { type: "attendre"; secondes: number };

export interface Routine {
  id: string;
  nom: string;
  declencheurs: string[];
  etapes: RoutineStep[];
}

export const DEFAULT_ROUTINES: Routine[] = [
  {
    id: "bonne-nuit",
    nom: "Bonne nuit",
    declencheurs: ["bonne nuit", "je vais me coucher", "je vais dormir"],
    etapes: [
      { type: "resume", quoi: "demain" },
      { type: "pages", action: "fermer_tout" },
      { type: "lumieres", cible: "toutes les lumieres", action: "eteindre" },
      { type: "ne_pas_deranger", actif: true },
      { type: "ecrans_veille" },
    ],
  },
  {
    id: "je-pars",
    nom: "Je pars",
    declencheurs: ["je pars", "je m'en vais", "j'y vais", "a plus tard jarvis"],
    etapes: [
      { type: "lumieres", cible: "tout", action: "eteindre" },
      { type: "surveillance", mode: "complete" },
      { type: "dire", texte: "Bonne route. Je garde la maison." },
    ],
  },
  {
    id: "je-rentre",
    nom: "Je suis rentré",
    declencheurs: ["je suis rentre", "je suis rentree", "je suis la", "me revoila", "c'est moi"],
    etapes: [
      { type: "surveillance", mode: "off" },
      { type: "ne_pas_deranger", actif: false },
      { type: "lumieres", cible: "salon", action: "allumer" },
      { type: "resume", quoi: "absence" },
    ],
  },
  {
    id: "session-simu",
    nom: "Session simu",
    declencheurs: ["je vais rouler", "session simu", "on va rouler", "prepare le simulateur"],
    etapes: [
      { type: "lumieres", cible: "simulateur", action: "allumer" },
      { type: "disposition", nom: "Course" },
      { type: "dire", texte: "Le baquet est prêt. Bonne séance." },
    ],
  },
];

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class Routines {
  private readonly store: JsonStore<Routine[]>;

  constructor(dataDir: string) {
    this.store = new JsonStore(dataDir, "routines", () => DEFAULT_ROUTINES.map((r) => ({ ...r, declencheurs: [...r.declencheurs], etapes: r.etapes.map((e) => ({ ...e })) })));
  }

  list(): Routine[] {
    return this.store.read();
  }

  /** La routine déclenchée par une phrase (phrase entière, sans « jarvis » ni politesse). */
  match(sentence: string): Routine | undefined {
    const t = fold(sentence).replace(/^(jarvis )?/, "").replace(/( jarvis| merci| stp)$/, "").trim();
    return this.list().find((r) => r.declencheurs.some((d) => fold(d) === t) || fold(r.nom) === t);
  }

  get(name: string): Routine | undefined {
    const n = fold(name);
    return this.list().find((r) => fold(r.nom) === n || r.id === n.replace(/ /g, "-") || r.declencheurs.some((d) => fold(d) === n));
  }

  save(input: { nom: string; declencheurs: string[]; etapes: RoutineStep[] }): Routine {
    if (!input.nom.trim() || !input.declencheurs.length || !input.etapes.length) throw new Error("Une routine a un nom, au moins une phrase de déclenchement et au moins une étape.");
    const id = fold(input.nom).replace(/ /g, "-");
    const routine: Routine = { id, nom: input.nom.trim(), declencheurs: input.declencheurs.map((d) => d.trim()).filter(Boolean), etapes: input.etapes };
    this.store.update((all) => [...all.filter((r) => r.id !== id), routine]);
    return routine;
  }

  remove(name: string): boolean {
    const found = this.get(name);
    if (!found) return false;
    this.store.update((all) => all.filter((r) => r.id !== found.id));
    return true;
  }
}

/** Exécute les étapes d'une routine ; une étape en échec n'arrête pas les suivantes. */
export async function runRoutine(routine: Routine, run: (step: RoutineStep) => Promise<string | void>): Promise<{ faits: string[]; erreurs: string[] }> {
  const faits: string[] = [];
  const erreurs: string[] = [];
  for (const step of routine.etapes) {
    try {
      if (step.type === "attendre") await new Promise((r) => setTimeout(r, Math.min(600, step.secondes) * 1000));
      const out = await run(step);
      if (out) faits.push(out);
    } catch (error) {
      erreurs.push(`${step.type} : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { faits, erreurs };
}

export interface Timer {
  id: string;
  fin: string;
  duree: number;
  libelle?: string;
}

export class Timers {
  private readonly store: JsonStore<Timer[]>;
  private readonly handles = new Map<string, NodeJS.Timeout>();

  constructor(dataDir: string, private readonly onDone: (timer: Timer) => void, private readonly now: () => number = Date.now) {
    this.store = new JsonStore(dataDir, "minuteurs", () => []);
  }

  /** Réarme les minuteurs encore en cours après un redémarrage. */
  restore(): void {
    const t = this.now();
    for (const timer of this.store.read()) {
      if (new Date(timer.fin).getTime() > t) this.arm(timer);
      else this.finish(timer);
    }
  }

  add(seconds: number, libelle?: string): Timer {
    const timer: Timer = { id: newId("min"), fin: new Date(this.now() + seconds * 1000).toISOString(), duree: seconds, ...(libelle ? { libelle } : {}) };
    this.store.update((all) => [...all, timer]);
    this.arm(timer);
    return timer;
  }

  private arm(timer: Timer): void {
    const delay = Math.max(0, new Date(timer.fin).getTime() - this.now());
    this.handles.set(timer.id, setTimeout(() => this.finish(timer), delay));
  }

  private finish(timer: Timer): void {
    this.handles.delete(timer.id);
    this.store.update((all) => all.filter((t) => t.id !== timer.id));
    this.onDone(timer);
  }

  list(): Array<Timer & { resteSecondes: number }> {
    const t = this.now();
    return this.store.read().map((x) => ({ ...x, resteSecondes: Math.max(0, Math.round((new Date(x.fin).getTime() - t) / 1000)) }));
  }

  cancelAll(): number {
    const all = this.store.read();
    for (const timer of all) clearTimeout(this.handles.get(timer.id));
    this.handles.clear();
    this.store.write([]);
    return all.length;
  }
}
