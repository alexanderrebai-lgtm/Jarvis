import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Diagnostic : Jarvis vérifie chacun de ses organes (cerveau, oreilles, voix,
 * caméras, maison, Spotify, planning, sauvegardes…) et dit quoi corriger.
 */

export type CheckState = "ok" | "attention" | "erreur" | "absent";

export interface CheckResult {
  id: string;
  groupe: string;
  titre: string;
  etat: CheckState;
  detail: string;
  /** Ce qu'Alex peut faire pour corriger. */
  conseil?: string;
  /** Bouton proposé sur la page (« connecter Spotify », « apprendre ma voix »). */
  action?: { libelle: string; commande?: string; reglages?: string };
}

export interface Check {
  id: string;
  groupe: string;
  titre: string;
  run: () => Promise<Omit<CheckResult, "id" | "groupe" | "titre">> | Omit<CheckResult, "id" | "groupe" | "titre">;
}

export async function runChecks(checks: Check[], timeoutMs = 8_000): Promise<CheckResult[]> {
  return Promise.all(
    checks.map(async (check) => {
      try {
        const result = await Promise.race([
          Promise.resolve(check.run()),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pas de réponse (délai dépassé)")), timeoutMs)),
        ]);
        return { id: check.id, groupe: check.groupe, titre: check.titre, ...result };
      } catch (error) {
        return { id: check.id, groupe: check.groupe, titre: check.titre, etat: "erreur" as const, detail: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}

/** Connexion de Claude Code sur ce PC (abonnement) ou clé API. */
export function claudeLoginCheck(env: NodeJS.ProcessEnv = process.env, home = homedir()): Omit<CheckResult, "id" | "groupe" | "titre"> {
  if (env.ANTHROPIC_API_KEY?.trim()) return { etat: "ok", detail: "Clé API réglée (facturée à l'usage)." };
  const candidates = [path.join(home, ".claude", ".credentials.json"), path.join(home, ".claude.json")];
  if (candidates.some((c) => existsSync(c))) return { etat: "ok", detail: "Connexion Claude Code trouvée (ton abonnement)." };
  return { etat: "erreur", detail: "Aucune connexion à Claude.", conseil: "Ouvre un terminal, lance « claude » et connecte-toi avec ton compte Claude." };
}

/** Résumé en une phrase, pour la voix. */
export function sayDiagnostic(results: CheckResult[]): string {
  const bad = results.filter((r) => r.etat === "erreur");
  const warn = results.filter((r) => r.etat === "attention");
  if (!bad.length && !warn.length) return "Tout est en ordre. Tous mes systèmes répondent.";
  const parts = [];
  if (bad.length) parts.push(`${bad.length} problème${bad.length > 1 ? "s" : ""} : ${bad.slice(0, 3).map((r) => r.titre.toLowerCase()).join(", ")}`);
  if (warn.length) parts.push(`${warn.length} point${warn.length > 1 ? "s" : ""} à surveiller`);
  return `Bilan : ${parts.join(", et ")}. Le détail est sur la page Diagnostic.`;
}
