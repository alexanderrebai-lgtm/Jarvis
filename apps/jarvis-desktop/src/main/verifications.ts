import { JsonStore } from "@muscu/jarvis/src/store.js";

/**
 * Test de bout en bout : pour chaque fonction de Jarvis, une vérification RÉELLE
 * (pas seulement « le réglage est rempli ») avec un verdict clair et ce qu'il
 * faut faire quand ça ne va pas. C'est ce qui dit si ce qu'on a construit marche
 * vraiment chez toi, sur ton matériel.
 */

export type EtatVerif = "ok" | "attention" | "echec" | "ignore";

export interface Verif {
  id: string;
  titre: string;
  etat: EtatVerif;
  detail: string;
  /** Quoi faire quand ce n'est pas vert. */
  conseil?: string;
  ms: number;
  le: string;
}

export interface Verdict {
  etat: EtatVerif;
  detail: string;
  conseil?: string;
}

export interface CheckDef {
  id: string;
  titre: string;
  lancer: () => Promise<Verdict>;
}

/** Lance les vérifications une par une (pas en parallèle : on ne martèle pas le réseau ni la carte graphique). */
export async function lancerVerifications(defs: CheckDef[], options: { delaiMs?: number; now?: () => Date; avant?: (d: CheckDef) => void } = {}): Promise<Verif[]> {
  const delai = options.delaiMs ?? 25_000;
  const out: Verif[] = [];
  for (const d of defs) {
    options.avant?.(d);
    const debut = Date.now();
    let verdict: Verdict;
    try {
      verdict = await Promise.race([d.lancer(), new Promise<Verdict>((resolve) => setTimeout(() => resolve({ etat: "echec", detail: `Pas de réponse en ${Math.round(delai / 1000)} s.`, conseil: "Vérifie que l'appareil ou le service est allumé et joignable, puis réessaie." }), delai).unref?.())]);
    } catch (error) {
      verdict = { etat: "echec", detail: error instanceof Error ? error.message : String(error) };
    }
    out.push({ id: d.id, titre: d.titre, ...verdict, ms: Date.now() - debut, le: (options.now?.() ?? new Date()).toISOString() });
  }
  return out;
}

export interface Rapport {
  ok: number;
  attention: number;
  echec: number;
  ignore: number;
}

export function resume(liste: Verif[]): Rapport {
  const r: Rapport = { ok: 0, attention: 0, echec: 0, ignore: 0 };
  for (const v of liste) r[v.etat] += 1;
  return r;
}

/** Phrase pour la voix ou Claude. */
export function phraseVerifications(liste: Verif[]): string {
  if (!liste.length) return "Je n'ai pas encore fait de test de bout en bout. Lance « Tester chez moi » dans Réglages.";
  const r = resume(liste);
  const mal = liste.filter((v) => v.etat === "echec" || v.etat === "attention").map((v) => `${v.titre} : ${v.detail}`);
  return `Test de bout en bout : ${r.ok} fonction(s) vérifiée(s) ${r.ok > 1 ? "qui marchent" : "qui marche"}, ${r.attention} à surveiller, ${r.echec} en échec, ${r.ignore} non configurée(s).${mal.length ? ` À regarder : ${mal.slice(0, 5).join(" ; ")}.` : ""}`;
}

interface State {
  parId: Record<string, Verif>;
}

/** Mémorise le dernier résultat de chaque vérification (un test isolé n'efface pas les autres). */
export class VerifStore {
  private readonly store: JsonStore<State>;

  constructor(dataDir: string) {
    this.store = new JsonStore(dataDir, "verifications", () => ({ parId: {} }));
  }

  save(liste: Verif[]): void {
    this.store.update((s) => ({ parId: { ...s.parId, ...Object.fromEntries(liste.map((v) => [v.id, v])) } }));
  }

  all(): Record<string, Verif> {
    return this.store.read().parId;
  }

  list(): Verif[] {
    return Object.values(this.all()).sort((a, b) => a.titre.localeCompare(b.titre));
  }
}
