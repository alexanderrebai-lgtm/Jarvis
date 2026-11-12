import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";

/**
 * Ce que montrent les pages Code et R&D : un dossier de projet, son arborescence,
 * le fichier en cours, l'aperçu du résultat et le journal. Tout se met à jour
 * quand Jarvis (ou Alex) modifie un fichier.
 */

const IGNORED = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".venv", "venv", ".next", ".cache", "target", ".idea", ".vscode"]);
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|txt|py|ipynb|html|css|scss|c|cpp|h|hpp|ino|rs|go|java|cs|sh|ps1|bat|yml|yaml|toml|ini|cfg|csv|scad|svg|xml|sql)$/i;
const MEDIA_EXT = /\.(stl|png|jpe?g|gif|webp|svg|pdf|mp4)$/i;

export interface FileEntry {
  chemin: string;
  taille: number;
  modifie: number;
}

export type Preview = { type: "url"; url: string } | { type: "fichier"; chemin: string; genre: PreviewGenre };

export interface ProjectSnapshot {
  dossier: string;
  nom: string;
  fichiers: FileEntry[];
  fichier?: { chemin: string; contenu: string; langage: string };
  apercu?: Preview & { version: number };
  journal?: string;
  medias: FileEntry[];
}

export function languageOf(file: string): string {
  const ext = path.extname(file).toLowerCase().slice(1);
  const map: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", py: "python", html: "html", css: "css", json: "json", md: "markdown", c: "c", cpp: "cpp", h: "c", ino: "cpp", rs: "rust", cs: "csharp", ps1: "powershell", scad: "openscad", sh: "bash" };
  return map[ext] ?? ext ?? "texte";
}

export type PreviewGenre = "page" | "image" | "modele3d" | "pdf" | "video";

export function previewKind(file: string): PreviewGenre | undefined {
  if (/\.html?$/i.test(file)) return "page";
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(file)) return "image";
  if (/\.stl$/i.test(file)) return "modele3d";
  if (/\.pdf$/i.test(file)) return "pdf";
  if (/\.mp4$/i.test(file)) return "video";
  return undefined;
}

/** Résout un chemin relatif au projet, sans jamais en sortir. */
export function insideProject(root: string, relative: string): string | undefined {
  const resolved = path.resolve(root, relative);
  const rel = path.relative(root, resolved);
  return rel.startsWith("..") || path.isAbsolute(rel) ? undefined : resolved;
}

export function listFiles(root: string, limit = 400): FileEntry[] {
  const out: FileEntry[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 5 || out.length >= limit) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries.sort((a, b) => a.localeCompare(b))) {
      if (IGNORED.has(name) || name.startsWith(".")) continue;
      const full = path.join(dir, name);
      let info;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) walk(full, depth + 1);
      else if (TEXT_EXT.test(name) || MEDIA_EXT.test(name)) out.push({ chemin: path.relative(root, full).replace(/\\/g, "/"), taille: info.size, modifie: info.mtimeMs });
      if (out.length >= limit) return;
    }
  };
  walk(root, 0);
  return out;
}

export class ProjectView {
  private root: string | undefined;
  private file: string | undefined;
  private preview: Preview | undefined;
  private version = 0;
  private watcher: FSWatcher | undefined;
  private debounce: NodeJS.Timeout | undefined;

  constructor(private readonly onChange: (snapshot: ProjectSnapshot) => void) {}

  get folder(): string | undefined {
    return this.root;
  }

  /** Montre un projet ; `fichier` et `apercu` sont relatifs au projet (ou une adresse http pour l'aperçu). */
  show(folder: string, options: { fichier?: string; apercu?: string } = {}): ProjectSnapshot {
    const root = path.resolve(folder);
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Dossier introuvable : ${root}`);
    if (root !== this.root) {
      this.watcher?.close();
      this.root = root;
      this.file = undefined;
      this.preview = undefined;
      try {
        // Surveillance récursive (Windows et macOS) : chaque modification rafraîchit la page.
        this.watcher = watch(root, { recursive: true }, (_event, name) => {
          if (name && [...IGNORED].some((dir) => String(name).split(/[\\/]/).includes(dir))) return;
          clearTimeout(this.debounce);
          this.debounce = setTimeout(() => {
            this.version += 1;
            this.onChange(this.snapshot());
          }, 250);
        });
      } catch {
        this.watcher = undefined;
      }
    }
    if (options.fichier) {
      if (!insideProject(root, options.fichier)) throw new Error("Ce fichier n'est pas dans le projet.");
      this.file = options.fichier.replace(/\\/g, "/");
    }
    if (options.apercu) {
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(options.apercu)) this.preview = { type: "url", url: options.apercu };
      else {
        const target = insideProject(root, options.apercu);
        const genre = previewKind(options.apercu);
        if (!target || !genre) throw new Error("Aperçu impossible : donne une page HTML, une image, un STL, un PDF, une vidéo du projet, ou une adresse http://localhost.");
        this.preview = { type: "fichier", chemin: options.apercu.replace(/\\/g, "/"), genre };
      }
    }
    this.version += 1;
    const snap = this.snapshot();
    this.onChange(snap);
    return snap;
  }

  close(): void {
    this.watcher?.close();
    this.root = undefined;
  }

  snapshot(): ProjectSnapshot {
    const root = this.root;
    if (!root) return { dossier: "", nom: "", fichiers: [], medias: [] };
    const fichiers = listFiles(root);
    let fichier: ProjectSnapshot["fichier"];
    const current = this.file && insideProject(root, this.file);
    if (current && existsSync(current) && TEXT_EXT.test(current) && statSync(current).size < 400_000) {
      fichier = { chemin: this.file!, contenu: readFileSync(current, "utf8"), langage: languageOf(current) };
    }
    const journalPath = ["JOURNAL.md", "journal.md", "README.md"].map((n) => path.join(root, n)).find((p) => existsSync(p));
    const medias = fichiers.filter((f) => MEDIA_EXT.test(f.chemin)).sort((a, b) => b.modifie - a.modifie).slice(0, 12);
    return {
      dossier: root,
      nom: path.basename(root),
      fichiers,
      ...(fichier ? { fichier } : {}),
      ...(this.preview ? { apercu: { ...this.preview, version: this.version } } : {}),
      ...(journalPath ? { journal: readFileSync(journalPath, "utf8").slice(0, 60_000) } : {}),
      medias,
    };
  }

  /** Lecture d'un fichier du projet pour l'aperçu (protocole interne de l'interface). */
  read(relative: string): Buffer | undefined {
    if (!this.root) return undefined;
    const target = insideProject(this.root, relative);
    return target && existsSync(target) ? readFileSync(target) : undefined;
  }
}
