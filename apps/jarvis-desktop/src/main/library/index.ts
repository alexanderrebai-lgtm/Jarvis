import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { chunkPages, extractDocument, LIBRARY_EXTENSIONS } from "./extract.js";

/**
 * Bibliothèque d'Alex : ses PDF, manuels, notices et notes, indexés sur le PC.
 * Recherche hybride : mots-clés (BM25) + sens (vecteurs d'un modèle multilingue
 * local), fusionnés. Sans modèle, la recherche par mots-clés marche seule.
 */

export interface Embedder {
  /** Vecteurs normalisés ; `kind` permet les préfixes « query: » / « passage: » des modèles E5. */
  embed: (texts: string[], kind: "query" | "passage") => Promise<Float32Array[]>;
  dimensions: number;
  name: string;
}

interface DocMeta {
  id: string;
  chemin: string;
  titre: string;
  modifie: number;
  taille: number;
  passages: number;
}

interface StoredChunk {
  doc: string;
  page: number;
  texte: string;
}

interface IndexFile {
  modele?: string;
  dimensions?: number;
  docs: DocMeta[];
  chunks: StoredChunk[];
}

export interface Passage {
  fichier: string;
  titre: string;
  page: number;
  texte: string;
  score: number;
}

const STOP = new Set("le la les un une des de du d l et ou en au aux a à dans par pour sur avec sans que qui quoi est sont ce cet cette ces il elle ils elles on nous vous je tu se sa son ses leur leurs mais plus pas ne y the of and to in is for on with as by an be are this that".split(" "));

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(ements?|ations?|iques?|s|x)$/, "") : w));
}

/** Index BM25 en mémoire, reconstruit au chargement. */
export class Bm25 {
  private readonly postings = new Map<string, Array<[number, number]>>();
  private readonly lengths: number[] = [];
  private avg = 0;

  constructor(texts: string[]) {
    texts.forEach((text, i) => {
      const counts = new Map<string, number>();
      const tokens = tokenize(text);
      for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
      for (const [t, c] of counts) {
        const list = this.postings.get(t) ?? [];
        list.push([i, c]);
        this.postings.set(t, list);
      }
      this.lengths[i] = tokens.length;
    });
    this.avg = this.lengths.reduce((a, b) => a + b, 0) / Math.max(1, this.lengths.length);
  }

  search(query: string, k = 20): Array<{ index: number; score: number }> {
    const scores = new Map<number, number>();
    const n = this.lengths.length;
    for (const term of new Set(tokenize(query))) {
      const list = this.postings.get(term);
      if (!list) continue;
      const idf = Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5));
      for (const [i, tf] of list) {
        const norm = tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * (this.lengths[i]! / (this.avg || 1))));
        scores.set(i, (scores.get(i) ?? 0) + idf * norm);
      }
    }
    return [...scores.entries()].map(([index, score]) => ({ index, score })).sort((a, b) => b.score - a.score).slice(0, k);
  }
}

/** Fusion de classements (Reciprocal Rank Fusion). */
export function fuseRankings(rankings: Array<Array<{ index: number }>>, k = 60): Array<{ index: number; score: number }> {
  const scores = new Map<number, number>();
  for (const ranking of rankings) ranking.forEach((r, rank) => scores.set(r.index, (scores.get(r.index) ?? 0) + 1 / (k + rank + 1)));
  return [...scores.entries()].map(([index, score]) => ({ index, score })).sort((a, b) => b.score - a.score);
}

export class Library {
  private readonly dir: string;
  private data: IndexFile;
  private vectors: Float32Array;
  private bm25: Bm25 | undefined;
  private indexing: Promise<unknown> | undefined;
  lastScan: { ajoutes: number; erreurs: string[]; at: string } | undefined;

  constructor(private readonly options: { dataDir: string; folder: string; embedder?: Embedder | undefined }) {
    this.dir = path.join(options.dataDir, "bibliotheque");
    mkdirSync(this.dir, { recursive: true });
    mkdirSync(options.folder, { recursive: true });
    this.data = this.loadIndex();
    this.vectors = this.loadVectors();
  }

  get folder(): string {
    return this.options.folder;
  }

  private loadIndex(): IndexFile {
    try {
      return JSON.parse(readFileSync(path.join(this.dir, "index.json"), "utf8")) as IndexFile;
    } catch {
      return { docs: [], chunks: [] };
    }
  }

  private loadVectors(): Float32Array {
    const file = path.join(this.dir, "vecteurs.bin");
    const e = this.options.embedder;
    if (!e || !existsSync(file) || this.data.modele !== e.name) return new Float32Array(0);
    const buf = readFileSync(file);
    const vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    return vectors.length === this.data.chunks.length * e.dimensions ? Float32Array.from(vectors) : new Float32Array(0);
  }

  private save(): void {
    const tmp = path.join(this.dir, "index.json.tmp");
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, path.join(this.dir, "index.json"));
    if (this.vectors.length) writeFileSync(path.join(this.dir, "vecteurs.bin"), Buffer.from(this.vectors.buffer, this.vectors.byteOffset, this.vectors.byteLength));
    this.bm25 = undefined;
  }

  status(): { documents: number; passages: number; semantique: boolean; dossier: string; dernierPassage?: string } {
    return { documents: this.data.docs.length, passages: this.data.chunks.length, semantique: this.hasVectors(), dossier: this.options.folder, ...(this.lastScan ? { dernierPassage: this.lastScan.at } : {}) };
  }

  documents(): Array<{ titre: string; chemin: string; passages: number }> {
    return this.data.docs.map((d) => ({ titre: d.titre, chemin: d.chemin, passages: d.passages }));
  }

  private hasVectors(): boolean {
    const e = this.options.embedder;
    return Boolean(e && this.vectors.length === this.data.chunks.length * e.dimensions && this.data.chunks.length > 0);
  }

  private async files(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".")) out.push(...(await this.files(full)));
      else if (entry.isFile() && LIBRARY_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) out.push(full);
    }
    return out;
  }

  /** Indexe les fichiers nouveaux ou modifiés du dossier (et retire ceux qui ont disparu). */
  scan(): Promise<{ ajoutes: number; erreurs: string[] }> {
    if (this.indexing) return this.indexing as Promise<{ ajoutes: number; erreurs: string[] }>;
    const run = (async () => {
      const files = await this.files(this.options.folder);
      const present = new Set(files.map((f) => path.resolve(f)));
      const removed = this.data.docs.filter((d) => !present.has(path.resolve(d.chemin)));
      for (const d of removed) this.removeDoc(d.id);
      let ajoutes = 0;
      const erreurs: string[] = [];
      for (const file of files) {
        const info = await stat(file).catch(() => undefined);
        if (!info || info.size > 150_000_000) continue;
        const existing = this.data.docs.find((d) => path.resolve(d.chemin) === path.resolve(file));
        if (existing && existing.modifie === info.mtimeMs && existing.taille === info.size) continue;
        try {
          await this.addFile(file, info.mtimeMs, info.size);
          ajoutes += 1;
        } catch (error) {
          erreurs.push(`${path.basename(file)} : ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (removed.length || ajoutes) this.save();
      this.lastScan = { ajoutes, erreurs, at: new Date().toISOString() };
      return { ajoutes, erreurs };
    })();
    this.indexing = run.finally(() => (this.indexing = undefined));
    return run;
  }

  private removeDoc(id: string): void {
    const dims = this.options.embedder?.dimensions ?? 0;
    const keep: number[] = [];
    this.data.chunks.forEach((c, i) => c.doc !== id && keep.push(i));
    if (this.hasVectors()) {
      const next = new Float32Array(keep.length * dims);
      keep.forEach((i, j) => next.set(this.vectors.subarray(i * dims, (i + 1) * dims), j * dims));
      this.vectors = next;
    }
    this.data.chunks = keep.map((i) => this.data.chunks[i]!);
    this.data.docs = this.data.docs.filter((d) => d.id !== id);
  }

  private async addFile(file: string, modifie: number, taille: number): Promise<void> {
    const id = createHash("sha1").update(path.resolve(file)).digest("hex").slice(0, 12);
    if (this.data.docs.some((d) => d.id === id)) this.removeDoc(id);
    const pages = await extractDocument(file);
    const chunks = chunkPages(pages);
    const e = this.options.embedder;
    let vectors: Float32Array[] | undefined;
    if (e) {
      try {
        vectors = [];
        for (let i = 0; i < chunks.length; i += 16) vectors.push(...(await e.embed(chunks.slice(i, i + 16).map((c) => c.texte), "passage")));
      } catch {
        vectors = undefined;
      }
    }
    // Sans vecteurs pour ce document, on garde la recherche par mots-clés pour toute la bibliothèque.
    const hadVectors = this.hasVectors() || this.data.chunks.length === 0;
    if (e && vectors && hadVectors) {
      const next = new Float32Array((this.data.chunks.length + chunks.length) * e.dimensions);
      next.set(this.vectors);
      vectors.forEach((v, j) => next.set(v.subarray(0, e.dimensions), (this.data.chunks.length + j) * e.dimensions));
      this.vectors = next;
      this.data.modele = e.name;
      this.data.dimensions = e.dimensions;
    } else this.vectors = new Float32Array(0);
    this.data.chunks.push(...chunks.map((c) => ({ doc: id, page: c.page, texte: c.texte })));
    this.data.docs.push({ id, chemin: file, titre: path.basename(file).replace(/\.[^.]+$/, ""), modifie, taille, passages: chunks.length });
  }

  async search(question: string, k = 6): Promise<Passage[]> {
    if (!this.data.chunks.length) return [];
    this.bm25 ??= new Bm25(this.data.chunks.map((c) => `${this.data.docs.find((d) => d.id === c.doc)?.titre ?? ""} ${c.texte}`));
    const keyword = this.bm25.search(question, 30);
    let semantic: Array<{ index: number; score: number }> = [];
    const e = this.options.embedder;
    if (e && this.hasVectors()) {
      try {
        const [q] = await e.embed([question], "query");
        const dims = e.dimensions;
        const scored: Array<{ index: number; score: number }> = [];
        for (let i = 0; i < this.data.chunks.length; i += 1) {
          let dot = 0;
          for (let d = 0; d < dims; d += 1) dot += q![d]! * this.vectors[i * dims + d]!;
          scored.push({ index: i, score: dot });
        }
        semantic = scored.sort((a, b) => b.score - a.score).slice(0, 30);
      } catch {
        semantic = [];
      }
    }
    const fused = semantic.length ? fuseRankings([keyword, semantic]) : keyword;
    return fused.slice(0, k).map(({ index, score }) => {
      const c = this.data.chunks[index]!;
      const doc = this.data.docs.find((d) => d.id === c.doc)!;
      return { fichier: doc.chemin, titre: doc.titre, page: c.page, texte: c.texte, score: Math.round(score * 1000) / 1000 };
    });
  }
}

/** Modèle multilingue E5 (français compris), exécuté sur le PC. */
export function e5Embedder(options: { cacheDir: string; model?: string }): Embedder {
  const model = options.model ?? "Xenova/multilingual-e5-small";
  let pipe: Promise<(texts: string[], o: Record<string, unknown>) => Promise<{ tolist: () => number[][] }>> | undefined;
  const load = () => {
    pipe ??= (async () => {
      const t = (await import("@huggingface/transformers")) as unknown as { env: { cacheDir: string }; pipeline: (task: string, model: string, o?: unknown) => Promise<(texts: string[], o: Record<string, unknown>) => Promise<{ tolist: () => number[][] }>> };
      t.env.cacheDir = options.cacheDir;
      return t.pipeline("feature-extraction", model, { dtype: "q8", device: "cpu" });
    })();
    pipe.catch(() => (pipe = undefined));
    return pipe;
  };
  return {
    name: model,
    dimensions: 384,
    embed: async (texts, kind) => {
      const extractor = await load();
      const output = await extractor(texts.map((t) => `${kind}: ${t}`), { pooling: "mean", normalize: true });
      return output.tolist().map((v) => Float32Array.from(v));
    },
  };
}
