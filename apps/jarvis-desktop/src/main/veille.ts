import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { JsonStore } from "@muscu/jarvis/src/store.js";

/**
 * Veille : chaque matin avant le réveil, Jarvis lit les flux d'actualité
 * (France, IA, simulation, travail), retient ce qui est nouveau et prépare un
 * résumé de ce qui compte pour Alex. Les grands titres alimentent le message du matin.
 */

export interface FeedItem {
  source: string;
  titre: string;
  lien: string;
  date?: string;
  resume?: string;
  categorie: string;
}

export interface FeedSource {
  nom: string;
  url: string;
  categorie: "france" | "ia" | "simulation" | "travail" | "science" | "autre";
}

export const DEFAULT_SOURCES: FeedSource[] = [
  { nom: "franceinfo", url: "https://www.francetvinfo.fr/titres.rss", categorie: "france" },
  { nom: "Le Monde", url: "https://www.lemonde.fr/rss/une.xml", categorie: "france" },
  { nom: "arXiv IA", url: "https://rss.arxiv.org/rss/cs.AI", categorie: "ia" },
  { nom: "arXiv langage", url: "https://rss.arxiv.org/rss/cs.CL", categorie: "ia" },
  { nom: "Hugging Face", url: "https://huggingface.co/blog/feed.xml", categorie: "ia" },
  { nom: "Le Mans Ultimate (Steam)", url: "https://store.steampowered.com/feeds/news/app/2399420/", categorie: "simulation" },
  { nom: "F1 25 (Steam)", url: "https://store.steampowered.com/feeds/news/app/3059520/", categorie: "simulation" },
];

export const DEFAULT_TOPICS = ["intelligence artificielle (modèles, agents, recherche)", "Le Mans Ultimate et F1 (mises à jour, setups, compétitions)", "simulation automobile et matériel (volants, pédaliers)", "management de centre d'appels et relation client", "actualité française importante"];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text" });
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const txt = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "#text" in v) return String((v as Record<string, unknown>)["#text"]);
  return "";
};
const stripTags = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** Lit un flux RSS 2.0 ou Atom. */
export function parseFeed(xmlText: string, source: FeedSource): FeedItem[] {
  const doc = parser.parse(xmlText);
  const rss = doc?.rss?.channel ?? doc?.["rdf:RDF"];
  if (rss) {
    return arr(rss.item ?? doc?.["rdf:RDF"]?.item).map((i: Record<string, unknown>) => ({
      source: source.nom,
      categorie: source.categorie,
      titre: stripTags(txt(i.title)),
      lien: txt(i.link) || txt(i.guid),
      ...(txt(i.pubDate) || txt(i["dc:date"]) ? { date: new Date(txt(i.pubDate) || txt(i["dc:date"])).toISOString() } : {}),
      ...(i.description ? { resume: stripTags(txt(i.description)).slice(0, 400) } : {}),
    }));
  }
  const feed = doc?.feed;
  return arr(feed?.entry).map((e: Record<string, unknown>) => {
    const links = arr(e.link as Array<Record<string, string>> | Record<string, string>);
    const link = links.find((l) => !l["@rel"] || l["@rel"] === "alternate")?.["@href"] ?? links[0]?.["@href"] ?? "";
    const date = txt(e.updated) || txt(e.published);
    return {
      source: source.nom,
      categorie: source.categorie,
      titre: stripTags(txt(e.title)),
      lien: link,
      ...(date ? { date: new Date(date).toISOString() } : {}),
      ...(e.summary || e.content ? { resume: stripTags(txt(e.summary ?? e.content)).slice(0, 400) } : {}),
    };
  });
}

interface VeilleState {
  sujets: string[];
  sources: FeedSource[];
  vus: string[];
  elements: FeedItem[];
  derniereLecture?: string;
}

export class Veille {
  private readonly store: JsonStore<VeilleState>;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly options: {
      dataDir: string;
      workspace: string;
      fetchFn?: typeof fetch;
      /** Résume les nouveautés pour Alex (Claude). */
      summarize?: (items: FeedItem[], topics: string[]) => Promise<string>;
      now?: () => Date;
    },
  ) {
    this.store = new JsonStore(options.dataDir, "veille", () => ({ sujets: DEFAULT_TOPICS, sources: DEFAULT_SOURCES, vus: [], elements: [] }));
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  get topics(): string[] {
    return this.store.read().sujets;
  }

  get sources(): FeedSource[] {
    return this.store.read().sources;
  }

  setTopics(add: string[] = [], remove: string[] = []): string[] {
    return this.store.update((s) => ({ ...s, sujets: [...new Set([...s.sujets.filter((t) => !remove.some((r) => t.toLowerCase().includes(r.toLowerCase()))), ...add])] })).sujets;
  }

  setSources(add: FeedSource[] = [], remove: string[] = []): FeedSource[] {
    return this.store.update((s) => ({ ...s, sources: [...s.sources.filter((x) => !remove.some((r) => x.nom.toLowerCase().includes(r.toLowerCase()) || x.url === r)), ...add] })).sources;
  }

  /** Lit tous les flux, garde les nouveautés (dédoublonnées), oublie ce qui a plus d'une semaine. */
  async refresh(): Promise<{ nouveaux: number; erreurs: string[] }> {
    const state = this.store.read();
    const fetchFn = this.options.fetchFn ?? fetch;
    const seen = new Set(state.vus);
    const fresh: FeedItem[] = [];
    const erreurs: string[] = [];
    await Promise.all(
      state.sources.map(async (source) => {
        try {
          const res = await fetchFn(source.url, { headers: { "user-agent": "Jarvis-veille/1.0", accept: "application/rss+xml, application/atom+xml, text/xml" }, signal: AbortSignal.timeout(15_000) });
          if (!res.ok) throw new Error(`erreur ${res.status}`);
          for (const item of parseFeed(await res.text(), source).slice(0, 40)) {
            const key = item.lien || `${item.source}:${item.titre}`;
            if (!item.titre || seen.has(key)) continue;
            seen.add(key);
            fresh.push(item);
          }
        } catch (error) {
          erreurs.push(`${source.nom} : ${error instanceof Error ? error.message : String(error)}`);
        }
      }),
    );
    const limit = this.now().getTime() - 7 * 86_400_000;
    this.store.update((s) => ({
      ...s,
      vus: [...seen].slice(-5000),
      elements: [...fresh, ...s.elements].filter((i) => !i.date || new Date(i.date).getTime() > limit).slice(0, 1500),
      derniereLecture: this.now().toISOString(),
    }));
    return { nouveaux: fresh.length, erreurs };
  }

  /** Éléments des dernières heures, éventuellement d'une catégorie. */
  recent(hours = 24, categorie?: string): FeedItem[] {
    const limit = this.now().getTime() - hours * 3_600_000;
    return this.store
      .read()
      .elements.filter((i) => (!categorie || i.categorie === categorie) && (!i.date || new Date(i.date).getTime() > limit))
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }

  /** Grands titres français (pour le message du matin). */
  headlines(count = 6): string[] {
    return this.recent(18, "france")
      .slice(0, count)
      .map((i) => i.titre);
  }

  private digestFile(date: string): string {
    return path.join(this.options.workspace, "veille", `${date}.md`);
  }

  /** Résumé du jour (préparé une fois, puis relu). */
  async digest(force = false): Promise<string | undefined> {
    const date = this.now().toISOString().slice(0, 10);
    const file = this.digestFile(date);
    if (!force && existsSync(file)) return readFileSync(file, "utf8");
    if (!this.options.summarize) return undefined;
    const items = this.recent(30).filter((i) => i.categorie !== "france").slice(0, 80);
    const france = this.recent(18, "france").slice(0, 20);
    if (!items.length && !france.length) return undefined;
    const text = await this.options.summarize([...france, ...items], this.topics);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `# Veille du ${date}\n\n${text}\n`);
    return text;
  }

  /** Lecture automatique toutes les 6 heures (et à 6 h, avant le réveil). */
  start(): void {
    const run = () => void this.refresh().catch(() => undefined);
    setTimeout(run, 60_000);
    this.timer = setInterval(() => {
      const h = this.now().getHours();
      const last = this.store.read().derniereLecture;
      const age = last ? this.now().getTime() - new Date(last).getTime() : Infinity;
      if (age > 6 * 3_600_000 || (h === 6 && age > 3_600_000)) run();
    }, 15 * 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
