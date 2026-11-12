import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { psString } from "./pc.js";

/**
 * Traçabilité : chaque action de Jarvis (outil, commande, fichier modifié) est
 * notée dans un journal du jour ; chaque fichier est copié avant d'être modifié
 * (on peut revenir en arrière) ; les suppressions passent par la corbeille.
 */

export interface ActionEntry {
  t: string;
  outil: string;
  resume: string;
  autorise: boolean;
  raison?: string;
  /** Qui a demandé : Alex (voix reconnue ou clavier), une voix inconnue, une automatisation. */
  origine?: string;
}

function day(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** Résumé lisible et court de ce qu'un outil a reçu (sans les images ni les très longs textes). */
export function summarizeInput(tool: string, input: Record<string, unknown>): string {
  const pick = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : undefined);
  const main = pick("command") ?? pick("script") ?? pick("file_path") ?? pick("chemin") ?? pick("url") ?? pick("query") ?? pick("cible") ?? pick("texte") ?? pick("titre");
  const text = main ?? JSON.stringify(input, (_k, v) => (typeof v === "string" && v.length > 200 ? `${v.slice(0, 200)}…` : v));
  return `${tool.replace(/^mcp__jarvis(_plus)?__/, "")} : ${text.replace(/\s+/g, " ").slice(0, 300)}`;
}

export class ActionLog {
  private readonly dir: string;

  constructor(dataDir: string, private readonly now: () => Date = () => new Date()) {
    this.dir = path.join(dataDir, "actions");
    mkdirSync(this.dir, { recursive: true });
  }

  add(entry: Omit<ActionEntry, "t">): void {
    const full: ActionEntry = { t: this.now().toISOString(), ...entry };
    appendFileSync(path.join(this.dir, `${day(this.now())}.jsonl`), `${JSON.stringify(full)}\n`);
  }

  /** Actions d'un jour (AAAA-MM-JJ, aujourd'hui par défaut). */
  day(date = day(this.now())): ActionEntry[] {
    const file = path.join(this.dir, `${date}.jsonl`);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as ActionEntry;
        } catch {
          return undefined;
        }
      })
      .filter((e): e is ActionEntry => Boolean(e));
  }

  days(): string[] {
    return readdirSync(this.dir)
      .filter((n) => n.endsWith(".jsonl"))
      .map((n) => n.slice(0, 10))
      .sort()
      .reverse();
  }
}

/** Copies des fichiers avant modification (une par fichier et par 10 minutes au plus). */
export class FileVersions {
  private readonly dir: string;
  private readonly recent = new Map<string, number>();

  constructor(dataDir: string, private readonly now: () => Date = () => new Date()) {
    this.dir = path.join(dataDir, "versions");
    mkdirSync(this.dir, { recursive: true });
  }

  private key(file: string): string {
    return path.resolve(file).replace(/[:\\/]+/g, "_").replace(/^_+/, "").slice(-180);
  }

  /** Copie le fichier tel qu'il est maintenant (s'il existe). Renvoie la copie. */
  snapshot(file: string): string | undefined {
    const resolved = path.resolve(file);
    if (!existsSync(resolved) || !statSync(resolved).isFile() || statSync(resolved).size > 50_000_000) return undefined;
    const t = this.now().getTime();
    if (t - (this.recent.get(resolved) ?? -Infinity) < 10 * 60_000) return undefined;
    this.recent.set(resolved, t);
    const folder = path.join(this.dir, day(this.now()));
    mkdirSync(folder, { recursive: true });
    const stampPart = this.now().toISOString().slice(11, 23).replace(/[:.]/g, "");
    let target = path.join(folder, `${stampPart}__${this.key(resolved)}`);
    for (let i = 1; existsSync(target); i += 1) target = path.join(folder, `${stampPart}${i}__${this.key(resolved)}`);
    copyFileSync(resolved, target);
    return target;
  }

  /** Versions enregistrées d'un fichier, de la plus récente à la plus ancienne. */
  list(file: string): Array<{ version: string; date: string; octets: number }> {
    const key = this.key(path.resolve(file));
    const out: Array<{ version: string; date: string; octets: number }> = [];
    for (const d of readdirSync(this.dir).sort().reverse()) {
      const folder = path.join(this.dir, d);
      if (!statSync(folder).isDirectory()) continue;
      for (const n of readdirSync(folder).sort().reverse()) {
        if (n.endsWith(`__${key}`)) out.push({ version: path.join(folder, n), date: `${d} ${n.slice(0, 2)}:${n.slice(2, 4)}:${n.slice(4, 6)}`, octets: statSync(path.join(folder, n)).size });
      }
    }
    return out;
  }

  /** Remet une version (en gardant une copie de l'état actuel). */
  restore(version: string, file: string): void {
    if (!path.resolve(version).startsWith(this.dir)) throw new Error("Cette version ne vient pas de mes copies.");
    this.recent.delete(path.resolve(file));
    this.snapshot(file);
    copyFileSync(version, file);
  }
}

/** Script PowerShell qui envoie des fichiers ou dossiers à la corbeille de Windows. */
export function recycleScript(paths: string[]): string {
  return [
    "Add-Type -AssemblyName Microsoft.VisualBasic",
    "$done = @()",
    ...paths.map(
      (p) =>
        `$p = ${psString(p)}; if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin'); $done += $p } elseif (Test-Path -LiteralPath $p) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin'); $done += $p } else { Write-Output "Introuvable : $p" }`,
    ),
    '"Dans la corbeille : " + ($done -join ", ")',
  ].join("\n");
}
