import { XMLParser } from "fast-xml-parser";

/**
 * Littérature scientifique : recherche directe dans arXiv, OpenAlex (clé gratuite
 * obligatoire depuis février 2026), PubMed et Semantic Scholar. Les résultats
 * sont ramenés à une forme commune (titre, auteurs, année, DOI, lien, résumé).
 */

export type LiteratureSource = "arxiv" | "openalex" | "pubmed" | "semanticscholar";

export interface Paper {
  source: LiteratureSource;
  titre: string;
  auteurs: string[];
  annee?: number;
  doi?: string;
  url: string;
  resume?: string;
  citations?: number;
  pdf?: string;
  revue?: string;
}

type Fetch = typeof fetch;
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text" });
const list = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const clean = (s: unknown) => (typeof s === "string" ? s : typeof s === "object" && s && "#text" in s ? String((s as { "#text": unknown })["#text"]) : String(s ?? "")).replace(/\s+/g, " ").trim();

export function parseArxiv(atom: string): Paper[] {
  const feed = xml.parse(atom).feed;
  return list(feed?.entry).map((e: Record<string, unknown>) => {
    const links = list(e.link as Array<Record<string, string>> | Record<string, string>);
    const pdf = links.find((l) => l["@title"] === "pdf")?.["@href"];
    const doi = clean(e["arxiv:doi"]) || undefined;
    return {
      source: "arxiv" as const,
      titre: clean(e.title),
      auteurs: list(e.author as Array<{ name: string }>).map((a) => clean(a.name)),
      annee: Number(clean(e.published).slice(0, 4)) || undefined,
      url: clean(e.id),
      resume: clean(e.summary),
      ...(pdf ? { pdf } : {}),
      ...(doi ? { doi } : {}),
    } as Paper;
  });
}

/** OpenAlex donne le résumé sous forme d'index inversé (mot → positions). */
export function invertedToText(index: Record<string, number[]> | null | undefined): string | undefined {
  if (!index) return undefined;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const p of positions) words[p] = word;
  return words.filter(Boolean).join(" ");
}

export function parseOpenAlex(json: { results?: Array<Record<string, unknown>> }): Paper[] {
  return (json.results ?? []).map((w) => {
    const loc = (w.primary_location ?? {}) as { landing_page_url?: string; pdf_url?: string; source?: { display_name?: string } };
    const oa = (w.open_access ?? {}) as { oa_url?: string };
    const doi = typeof w.doi === "string" ? w.doi.replace(/^https?:\/\/doi\.org\//, "") : undefined;
    const resume = invertedToText(w.abstract_inverted_index as Record<string, number[]> | undefined);
    return {
      source: "openalex" as const,
      titre: clean(w.display_name ?? w.title),
      auteurs: ((w.authorships ?? []) as Array<{ author?: { display_name?: string } }>).map((a) => a.author?.display_name ?? "").filter(Boolean),
      annee: typeof w.publication_year === "number" ? w.publication_year : undefined,
      url: loc.landing_page_url ?? (doi ? `https://doi.org/${doi}` : String(w.id ?? "")),
      citations: typeof w.cited_by_count === "number" ? w.cited_by_count : undefined,
      ...(doi ? { doi } : {}),
      ...(resume ? { resume } : {}),
      ...(loc.pdf_url || oa.oa_url ? { pdf: loc.pdf_url ?? oa.oa_url } : {}),
      ...(loc.source?.display_name ? { revue: loc.source.display_name } : {}),
    } as Paper;
  });
}

export function parseSemanticScholar(json: { data?: Array<Record<string, unknown>> }): Paper[] {
  return (json.data ?? []).map((p) => {
    const ids = (p.externalIds ?? {}) as { DOI?: string; ArXiv?: string };
    const pdf = (p.openAccessPdf as { url?: string } | null)?.url;
    return {
      source: "semanticscholar" as const,
      titre: clean(p.title),
      auteurs: ((p.authors ?? []) as Array<{ name: string }>).map((a) => a.name),
      annee: typeof p.year === "number" ? p.year : undefined,
      url: String(p.url ?? ""),
      citations: typeof p.citationCount === "number" ? p.citationCount : undefined,
      ...(typeof p.abstract === "string" ? { resume: p.abstract } : {}),
      ...(ids.DOI ? { doi: ids.DOI } : {}),
      ...(pdf ? { pdf } : {}),
      ...(typeof p.venue === "string" && p.venue ? { revue: p.venue } : {}),
    } as Paper;
  });
}

export function parsePubmedSummary(json: { result?: Record<string, unknown> & { uids?: string[] } }, abstracts: Record<string, string> = {}): Paper[] {
  const result = json.result ?? {};
  return (result.uids ?? []).map((uid) => {
    const r = result[uid] as { title?: string; authors?: Array<{ name: string }>; pubdate?: string; fulljournalname?: string; articleids?: Array<{ idtype: string; value: string }> };
    const doi = r.articleids?.find((a) => a.idtype === "doi")?.value;
    return {
      source: "pubmed" as const,
      titre: clean(r.title),
      auteurs: (r.authors ?? []).map((a) => a.name),
      annee: Number(String(r.pubdate ?? "").slice(0, 4)) || undefined,
      url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
      ...(doi ? { doi } : {}),
      ...(abstracts[uid] ? { resume: abstracts[uid] } : {}),
      ...(r.fulljournalname ? { revue: r.fulljournalname } : {}),
    } as Paper;
  });
}

/** Résumés PubMed (efetch, XML) par identifiant. */
export function parsePubmedAbstracts(text: string): Record<string, string> {
  const doc = xml.parse(text);
  const out: Record<string, string> = {};
  for (const article of list(doc?.PubmedArticleSet?.PubmedArticle)) {
    const citation = (article as { MedlineCitation?: { PMID?: unknown; Article?: { Abstract?: { AbstractText?: unknown } } } }).MedlineCitation;
    const id = clean(citation?.PMID);
    const parts = list(citation?.Article?.Abstract?.AbstractText as unknown[] | unknown);
    if (id && parts.length) out[id] = parts.map(clean).join(" ");
  }
  return out;
}

export class Literature {
  private readonly fetchFn: Fetch;

  constructor(private readonly options: { openAlexKey?: string | undefined; semanticScholarKey?: string | undefined; ncbiKey?: string | undefined; fetchFn?: Fetch } = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private async get(url: string, headers: Record<string, string> = {}): Promise<Response> {
    const res = await this.fetchFn(url, { headers: { "user-agent": "Jarvis-recherche/1.0", ...headers } });
    if (!res.ok) throw new Error(`${new URL(url).hostname} : erreur ${res.status}`);
    return res;
  }

  async arxiv(query: string, limit: number): Promise<Paper[]> {
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`all:${query}`)}&start=0&max_results=${limit}&sortBy=relevance`;
    return parseArxiv(await (await this.get(url)).text());
  }

  async openalex(query: string, limit: number, since?: number): Promise<Paper[]> {
    if (!this.options.openAlexKey) throw new Error("OpenAlex demande une clé gratuite depuis février 2026 : règle OPENALEX_CLE (openalex.org → paramètres → API).");
    const filter = since ? `&filter=from_publication_date:${since}-01-01` : "";
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}${filter}&api_key=${encodeURIComponent(this.options.openAlexKey)}`;
    return parseOpenAlex((await (await this.get(url)).json()) as { results?: Array<Record<string, unknown>> });
  }

  async semanticScholar(query: string, limit: number, since?: number): Promise<Paper[]> {
    const fields = "title,authors,year,abstract,url,citationCount,externalIds,openAccessPdf,venue";
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}${since ? `&year=${since}-` : ""}`;
    const headers: Record<string, string> = this.options.semanticScholarKey ? { "x-api-key": this.options.semanticScholarKey } : {};
    return parseSemanticScholar((await (await this.get(url, headers)).json()) as { data?: Array<Record<string, unknown>> });
  }

  async pubmed(query: string, limit: number, since?: number): Promise<Paper[]> {
    const key = this.options.ncbiKey ? `&api_key=${this.options.ncbiKey}` : "";
    const term = since ? `${query} AND ${since}:3000[dp]` : query;
    const search = (await (await this.get(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${limit}&term=${encodeURIComponent(term)}${key}`)).json()) as { esearchresult?: { idlist?: string[] } };
    const ids = search.esearchresult?.idlist ?? [];
    if (!ids.length) return [];
    const [summary, abstracts] = await Promise.all([
      this.get(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}${key}`).then((r) => r.json()),
      this.get(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&rettype=abstract&id=${ids.slice(0, 8).join(",")}${key}`)
        .then((r) => r.text())
        .then(parsePubmedAbstracts)
        .catch(() => ({})),
    ]);
    return parsePubmedSummary(summary as { result?: Record<string, unknown> & { uids?: string[] } }, abstracts);
  }

  /** Recherche dans plusieurs sources ; une source en panne n'empêche pas les autres. */
  async search(query: string, options: { sources?: LiteratureSource[]; limit?: number; since?: number } = {}): Promise<{ articles: Paper[]; erreurs: string[] }> {
    const sources = options.sources ?? ["arxiv", "semanticscholar", ...(this.options.openAlexKey ? (["openalex"] as const) : []), "pubmed"];
    const limit = Math.min(25, options.limit ?? 8);
    const erreurs: string[] = [];
    const runs = await Promise.all(
      sources.map(async (source) => {
        try {
          if (source === "arxiv") return await this.arxiv(query, limit);
          if (source === "openalex") return await this.openalex(query, limit, options.since);
          if (source === "semanticscholar") return await this.semanticScholar(query, limit, options.since);
          return await this.pubmed(query, limit, options.since);
        } catch (error) {
          erreurs.push(`${source} : ${error instanceof Error ? error.message : String(error)}`);
          return [];
        }
      }),
    );
    // Dédoublonnage par DOI, sinon par titre.
    const seen = new Set<string>();
    const articles: Paper[] = [];
    for (const paper of runs.flat()) {
      const key = paper.doi?.toLowerCase() ?? paper.titre.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (paper.resume && paper.resume.length > 1400) paper.resume = `${paper.resume.slice(0, 1400)}…`;
      articles.push(paper);
    }
    return { articles, erreurs };
  }
}

/** Consigne d'une recherche approfondie (tâche de fond). */
export function deepResearchPrompt(options: { sujet: string; objectif?: string | undefined; profondeur: "rapide" | "normale" | "poussee"; fichier: string; date: string }): string {
  const budget = { rapide: "8 à 12 sources", normale: "15 à 25 sources", poussee: "30 sources ou plus, avec les articles fondateurs et les plus récents" }[options.profondeur];
  return `Recherche approfondie demandée par Alex (${options.date}).
Sujet : ${options.sujet}
${options.objectif ? `Ce qu'il veut en faire : ${options.objectif}\n` : ""}
Méthode, sans raccourci :
1. Décompose le sujet en 4 à 8 sous-questions précises. Note-les.
2. Pour chaque sous-question, cherche : web (WebSearch, WebFetch pour lire les pages), littérature scientifique (litterature_chercher : arXiv, Semantic Scholar, OpenAlex, PubMed), et la bibliothèque d'Alex (bibliotheque_chercher) si c'est pertinent. Vise ${budget}. Privilégie les sources primaires (articles, documentation officielle, normes, données) ; lis-les vraiment, pas seulement leur titre.
3. Recoupe : une affirmation importante doit s'appuyer sur au moins deux sources indépendantes, sinon dis-le. Relève les contradictions et explique-les si tu peux.
4. Quand un chiffre se calcule, calcule-le (labo_python), ne l'estime pas.
5. Écris le rapport en Markdown dans ${options.fichier} avec : « Réponse courte » (5 lignes), « Ce qui est établi », « Ce qui est débattu », « Ce qui reste inconnu », « Recommandation » (ton avis argumenté), « Pour aller plus loin », puis « Sources » numérotées [1], [2]… (auteurs, titre, année, lien). Chaque affirmation du rapport porte son numéro de source et un niveau de confiance (élevé, moyen, faible). Date tes informations.
6. Termine ta réponse par un résumé de deux phrases, à dire à voix haute.`;
}
