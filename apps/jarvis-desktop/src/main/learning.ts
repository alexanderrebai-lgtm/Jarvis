import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { JsonStore, newId } from "@muscu/jarvis/src/store.js";

/**
 * Mode mentor : Jarvis peut faire à la place d'Alex, faire avec lui, ou le
 * guider pour qu'il devienne autonome. Parcours d'apprentissage par étapes, et
 * fiches de révision espacées (algorithme SM-2, comme Anki).
 */

export type MentorMode = "fais" | "avec" | "guide";

export const MENTOR_LABELS: Record<MentorMode, string> = {
  fais: "Fais-le pour moi",
  avec: "Fais-le avec moi",
  guide: "Guide-moi",
};

export function mentorInstruction(mode: MentorMode): string {
  if (mode === "fais") return "";
  if (mode === "avec")
    return "[Mode d'aide : « fais-le avec moi ». Fais le travail par petites étapes en expliquant chacune (le quoi et le pourquoi), propose à Alex de faire lui-même les étapes simples, et vérifie qu'il suit avant de continuer.]";
  return "[Mode d'aide : « guide-moi ». Alex veut apprendre à le faire seul. Ne donne pas la solution complète : explique la méthode, donne un indice ou la première étape, pose-lui une question pour qu'il trouve, corrige ce qu'il propose. Donne la solution seulement s'il la demande explicitement ou s'il bloque deux fois. Termine par ce qu'il doit retenir, et propose de l'ajouter à ses fiches de révision.]";
}

export interface PathStep {
  titre: string;
  objectif: string;
  ressources?: string[];
  exercice?: string;
  fait: boolean;
  note?: string;
  faitLe?: string;
}

export interface LearningPath {
  id: string;
  sujet: string;
  objectif: string;
  niveau: string;
  creeLe: string;
  etapes: PathStep[];
}

export interface Card {
  id: string;
  sujet: string;
  question: string;
  reponse: string;
  facilite: number;
  intervalle: number;
  repetitions: number;
  prochaine: string;
}

/** SM-2 : note de 0 (trou noir) à 5 (parfait) → prochaine révision. */
export function reviewCard(card: Card, grade: number, now = new Date()): Card {
  const q = Math.max(0, Math.min(5, Math.round(grade)));
  let { facilite, intervalle, repetitions } = card;
  if (q < 3) {
    repetitions = 0;
    intervalle = 1;
  } else {
    repetitions += 1;
    intervalle = repetitions === 1 ? 1 : repetitions === 2 ? 6 : Math.round(intervalle * facilite);
  }
  facilite = Math.max(1.3, facilite + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  const next = new Date(now.getTime() + intervalle * 86_400_000);
  return { ...card, facilite: Math.round(facilite * 100) / 100, intervalle, repetitions, prochaine: next.toISOString() };
}

function slug(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sujet";
}

export class Learning {
  private readonly paths: JsonStore<LearningPath[]>;
  private readonly cards: JsonStore<Card[]>;
  private readonly settings: JsonStore<{ mode: MentorMode }>;

  constructor(dataDir: string, private readonly workspace: string, private readonly now: () => Date = () => new Date()) {
    this.paths = new JsonStore(dataDir, "parcours", () => []);
    this.cards = new JsonStore(dataDir, "revisions", () => []);
    this.settings = new JsonStore(dataDir, "mentor", () => ({ mode: "fais" }));
  }

  get mode(): MentorMode {
    return this.settings.read().mode;
  }

  setMode(mode: MentorMode): void {
    this.settings.write({ mode });
  }

  createPath(input: { sujet: string; objectif: string; niveau: string; etapes: Array<Omit<PathStep, "fait">> }): LearningPath {
    const path0: LearningPath = { id: slug(input.sujet), sujet: input.sujet, objectif: input.objectif, niveau: input.niveau, creeLe: this.now().toISOString(), etapes: input.etapes.map((e) => ({ ...e, fait: false })) };
    this.paths.update((all) => [...all.filter((p) => p.id !== path0.id), path0]);
    this.writeMarkdown(path0);
    return path0;
  }

  listPaths(): Array<{ sujet: string; avancement: string; prochaine?: string }> {
    return this.paths.read().map((p) => {
      const done = p.etapes.filter((e) => e.fait).length;
      const next = p.etapes.find((e) => !e.fait);
      return { sujet: p.sujet, avancement: `${done}/${p.etapes.length}`, ...(next ? { prochaine: next.titre } : {}) };
    });
  }

  getPath(sujet: string): LearningPath | undefined {
    const id = slug(sujet);
    return this.paths.read().find((p) => p.id === id || p.id.includes(id));
  }

  completeStep(sujet: string, etape: number, note?: string): LearningPath {
    const found = this.getPath(sujet);
    if (!found) throw new Error(`Aucun parcours « ${sujet} ».`);
    if (etape < 1 || etape > found.etapes.length) throw new Error(`Étape ${etape} inexistante (1 à ${found.etapes.length}).`);
    const updated = { ...found, etapes: found.etapes.map((e, i) => (i === etape - 1 ? { ...e, fait: true, faitLe: this.now().toISOString(), ...(note ? { note } : {}) } : e)) };
    this.paths.update((all) => all.map((p) => (p.id === found.id ? updated : p)));
    this.writeMarkdown(updated);
    return updated;
  }

  private writeMarkdown(p: LearningPath): void {
    const dir = path.join(this.workspace, "apprentissage", p.id);
    mkdirSync(dir, { recursive: true });
    const lines = [
      `# Parcours : ${p.sujet}`,
      "",
      `**Objectif** : ${p.objectif}  `,
      `**Point de départ** : ${p.niveau}`,
      "",
      ...p.etapes.flatMap((e, i) => [
        `## ${e.fait ? "✅" : "⬜"} ${i + 1}. ${e.titre}`,
        "",
        e.objectif,
        ...(e.ressources?.length ? ["", "Ressources :", ...e.ressources.map((r) => `- ${r}`)] : []),
        ...(e.exercice ? ["", `**Exercice** : ${e.exercice}`] : []),
        ...(e.note ? ["", `> ${e.note}`] : []),
        "",
      ]),
    ];
    writeFileSync(path.join(dir, "PARCOURS.md"), lines.join("\n"));
  }

  addCards(sujet: string, items: Array<{ question: string; reponse: string }>): number {
    const now = this.now().toISOString();
    const created = items.map((i) => ({ id: newId("fiche"), sujet, question: i.question, reponse: i.reponse, facilite: 2.5, intervalle: 0, repetitions: 0, prochaine: now }));
    this.cards.update((all) => [...all, ...created]);
    return created.length;
  }

  due(sujet?: string, limit = 20): Card[] {
    const now = this.now().getTime();
    return this.cards
      .read()
      .filter((c) => new Date(c.prochaine).getTime() <= now && (!sujet || c.sujet.toLowerCase().includes(sujet.toLowerCase())))
      .slice(0, limit);
  }

  grade(id: string, note: number): Card {
    const card = this.cards.read().find((c) => c.id === id);
    if (!card) throw new Error("Fiche introuvable.");
    const next = reviewCard(card, note, this.now());
    this.cards.update((all) => all.map((c) => (c.id === id ? next : c)));
    return next;
  }

  stats(): { fiches: number; aReviser: number; parcours: number } {
    return { fiches: this.cards.read().length, aReviser: this.due(undefined, 10_000).length, parcours: this.paths.read().length };
  }
}
