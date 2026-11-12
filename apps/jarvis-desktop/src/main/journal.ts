import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Journal de bord : chaque échange avec Alex est noté (date, demande, réponse,
 * outils utilisés), un fichier par jour. Jarvis peut y rechercher ce qui a été
 * fait la semaine dernière ou il y a six mois.
 */

export interface JournalEntry {
  date: string;
  demande: string;
  reponse: string;
  outils: string[];
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export class Journal {
  private readonly dir: string;

  constructor(dataDir: string, private readonly now: () => Date = () => new Date()) {
    this.dir = path.join(dataDir, "journal");
    mkdirSync(this.dir, { recursive: true });
  }

  add(entry: Omit<JournalEntry, "date">): void {
    const date = this.now();
    const file = path.join(this.dir, `${date.toISOString().slice(0, 10)}.jsonl`);
    const line: JournalEntry = {
      date: date.toISOString(),
      demande: entry.demande.slice(0, 4000),
      reponse: entry.reponse.slice(0, 6000),
      outils: [...new Set(entry.outils)].slice(0, 30),
    };
    appendFileSync(file, `${JSON.stringify(line)}\n`);
  }

  /** Recherche (tous les mots, sans accents) dans les N derniers jours, du plus récent au plus ancien. */
  search(query: string | undefined, days = 30, limit = 25): JournalEntry[] {
    const since = this.now().getTime() - days * 86_400_000;
    const words = query ? normalize(query).split(/\s+/).filter((w) => w.length > 1) : [];
    const files = readdirSync(this.dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && new Date(f.slice(0, 10)).getTime() >= since - 86_400_000)
      .sort()
      .reverse();
    const results: JournalEntry[] = [];
    for (const file of files) {
      const lines = readFileSync(path.join(this.dir, file), "utf8").split("\n").filter(Boolean).reverse();
      for (const line of lines) {
        let entry: JournalEntry;
        try {
          entry = JSON.parse(line) as JournalEntry;
        } catch {
          continue;
        }
        if (new Date(entry.date).getTime() < since) continue;
        const haystack = normalize(`${entry.demande} ${entry.reponse}`);
        if (words.every((w) => haystack.includes(w))) results.push(entry);
        if (results.length >= limit) return results;
      }
    }
    return results;
  }
}
