import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

/**
 * Sauvegardes : chaque nuit, une archive .zip de la mémoire de Jarvis (notes,
 * journal, réglages), de tes projets et de tes documents de travail. On garde
 * les 14 derniers jours et une archive par semaine sur 8 semaines. Une copie
 * peut partir dans un second dossier (OneDrive, disque externe).
 */

export interface BackupSource {
  nom: string;
  dossier: string;
}

export interface BackupOptions {
  sources: BackupSource[];
  destination: string;
  /** Second dossier où copier l'archive (OneDrive, disque externe). */
  copie?: string | undefined;
  keepDaily?: number;
  keepWeekly?: number;
  /** Fichiers plus gros ignorés (Mo). */
  maxFileMb?: number;
}

const SKIP_DIRS = new Set(["node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".cache", "modeles-voix", "sauvegardes", ".next", "target", "release"]);
const COMPRESSED = /\.(zip|7z|rar|gz|png|jpe?g|mp4|mkv|mp3|webm|pdf|docx|xlsx|pptx|stl|3mf)$/i;

async function* walk(dir: string, base: string): AsyncGenerator<{ full: string; rel: string; size: number }> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full, base);
    } else if (entry.isFile()) {
      const info = await stat(full).catch(() => undefined);
      if (info) yield { full, rel: path.relative(base, full).split(path.sep).join("/"), size: info.size };
    }
  }
}

function stamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Crée l'archive du jour. Renvoie son chemin, le nombre de fichiers et la taille. */
export async function createBackup(options: BackupOptions, now = new Date()): Promise<{ fichier: string; fichiers: number; octets: number; ignores: string[] }> {
  mkdirSync(options.destination, { recursive: true });
  const target = path.join(options.destination, `jarvis-${stamp(now)}.zip`);
  const tmp = `${target}.tmp`;
  const out = createWriteStream(tmp);
  const maxBytes = (options.maxFileMb ?? 200) * 1_000_000;
  let count = 0;
  const ignored: string[] = [];
  const done = new Promise<void>((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", reject);
  });
  let failure: Error | undefined;
  const zip = new Zip((error, chunk, final) => {
    if (error) failure = error;
    else out.write(Buffer.from(chunk));
    if (final || error) out.end();
  });
  for (const source of options.sources) {
    if (!existsSync(source.dossier)) continue;
    for await (const file of walk(source.dossier, source.dossier)) {
      if (file.size > maxBytes || file.full.startsWith(options.destination)) {
        ignored.push(`${source.nom}/${file.rel}`);
        continue;
      }
      const entry = COMPRESSED.test(file.rel) ? new ZipPassThrough(`${source.nom}/${file.rel}`) : new ZipDeflate(`${source.nom}/${file.rel}`, { level: 6 });
      zip.add(entry);
      await new Promise<void>((resolve) => {
        const stream = createReadStream(file.full);
        stream.on("data", (chunk) => entry.push(new Uint8Array(chunk as Buffer)));
        stream.on("end", () => {
          entry.push(new Uint8Array(0), true);
          resolve();
        });
        stream.on("error", () => {
          // Fichier verrouillé (ouvert dans Excel…) : on le note et on continue.
          entry.push(new Uint8Array(0), true);
          ignored.push(`${source.nom}/${file.rel}`);
          resolve();
        });
      });
      count += 1;
    }
  }
  zip.end();
  await done;
  if (failure) throw failure;
  rmSync(target, { force: true });
  const { renameSync, copyFileSync } = await import("node:fs");
  renameSync(tmp, target);
  if (options.copie) {
    try {
      mkdirSync(options.copie, { recursive: true });
      copyFileSync(target, path.join(options.copie, path.basename(target)));
      rotate(options.copie, options.keepDaily, options.keepWeekly);
    } catch (error) {
      ignored.push(`copie vers ${options.copie} impossible : ${error instanceof Error ? error.message : error}`);
    }
  }
  rotate(options.destination, options.keepDaily, options.keepWeekly);
  return { fichier: target, fichiers: count, octets: statSync(target).size, ignores: ignored };
}

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-${Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)}`;
}

/** Garde les N derniers jours et une archive par semaine sur M semaines. */
export function selectKept(names: string[], keepDaily = 14, keepWeekly = 8): Set<string> {
  const dated = names
    .map((n) => ({ n, d: n.match(/jarvis-(\d{4}-\d{2}-\d{2})\.zip$/)?.[1] }))
    .filter((x): x is { n: string; d: string } => Boolean(x.d))
    .sort((a, b) => b.d.localeCompare(a.d));
  const keep = new Set(dated.slice(0, keepDaily).map((x) => x.n));
  const weeks = new Set<string>();
  for (const x of dated) {
    const week = isoWeek(new Date(`${x.d}T12:00:00Z`));
    if (weeks.has(week)) continue;
    weeks.add(week);
    if (weeks.size <= keepWeekly) keep.add(x.n);
  }
  return keep;
}

export function rotate(dir: string, keepDaily?: number, keepWeekly?: number): string[] {
  const names = readdirSync(dir).filter((n) => /^jarvis-\d{4}-\d{2}-\d{2}\.zip$/.test(n));
  const keep = selectKept(names, keepDaily, keepWeekly);
  const removed = names.filter((n) => !keep.has(n));
  for (const n of removed) rmSync(path.join(dir, n), { force: true });
  return removed;
}

export function listBackups(dir: string): Array<{ fichier: string; date: string; octets: number }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^jarvis-\d{4}-\d{2}-\d{2}\.zip$/.test(n))
    .sort()
    .reverse()
    .map((n) => ({ fichier: path.join(dir, n), date: n.slice(7, 17), octets: statSync(path.join(dir, n)).size }));
}

/** Sauvegarde automatique chaque nuit (et au démarrage si la dernière date de plus de 24 h). */
export class BackupService {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  last: { date: string; fichiers: number; octets: number; erreur?: string } | undefined;

  constructor(private readonly options: BackupOptions & { hour?: number; onDone?: (result: { fichier: string; fichiers: number }) => void }) {
    const latest = listBackups(options.destination)[0];
    if (latest) this.last = { date: latest.date, fichiers: 0, octets: latest.octets };
  }

  start(): void {
    const check = () => {
      const now = new Date();
      const today = stamp(now);
      const due = !this.last || (this.last.date < today && now.getHours() >= (this.options.hour ?? 3));
      if (due) void this.run();
    };
    setTimeout(check, 90_000);
    this.timer = setInterval(check, 30 * 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<{ fichier: string; fichiers: number; octets: number; ignores: string[] } | undefined> {
    if (this.running) return undefined;
    this.running = true;
    try {
      const result = await createBackup(this.options);
      this.last = { date: stamp(new Date()), fichiers: result.fichiers, octets: result.octets };
      this.options.onDone?.(result);
      return result;
    } catch (error) {
      this.last = { date: this.last?.date ?? "", fichiers: 0, octets: 0, erreur: error instanceof Error ? error.message : String(error) };
      throw error;
    } finally {
      this.running = false;
    }
  }
}
