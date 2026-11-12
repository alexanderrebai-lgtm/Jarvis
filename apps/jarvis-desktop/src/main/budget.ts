import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { JsonStore } from "@muscu/jarvis/src/store.js";

/**
 * Budget : Jarvis lit les relevés de compte que tu exportes de ta banque
 * (fichiers CSV), classe chaque opération par catégorie, et fait le point du
 * mois. Aucun identifiant bancaire n'est demandé ni stocké.
 */

export interface Operation {
  id: string;
  date: string;
  libelle: string;
  montant: number;
  categorie: string;
  compte?: string;
}

export interface Rule {
  motif: string;
  categorie: string;
}

export const DEFAULT_RULES: Rule[] = [
  { motif: "salaire|paie|virement.*(employeur|salaire)", categorie: "Revenus" },
  { motif: "caf\\b|pole emploi|france travail|cpam|remboursement", categorie: "Remboursements et aides" },
  { motif: "loyer|bailleur|syndic|habitat", categorie: "Logement" },
  { motif: "edf|engie|total ?energies|eau |veolia|suez|gaz", categorie: "Énergie et eau" },
  { motif: "orange|sfr|bouygues|free ?mobile|free telecom|sosh|red by", categorie: "Téléphone et Internet" },
  { motif: "carrefour|leclerc|auchan|lidl|aldi|intermarche|super u|hyper u|casino|monoprix|franprix|picard|grand frais|netto", categorie: "Courses" },
  { motif: "total|esso|shell|bp |avia|station|carburant|peage|sanef|aprr|vinci autoroutes|parking|sncf|ratp|uber(?! eats)|blablacar", categorie: "Transport et carburant" },
  { motif: "norauto|feu vert|speedy|midas|oscaro|mister auto|controle technique|autodistribution", categorie: "Voiture" },
  { motif: "netflix|spotify|disney|canal|prime video|amazon prime|deezer|youtube premium|apple\\.com|icloud|google storage|anthropic|claude|openai|chatgpt", categorie: "Abonnements" },
  { motif: "steam|playstation|xbox|nintendo|epic games|fanatec|thrustmaster|moza|simucube|iracing|le mans ultimate|motorsport games", categorie: "Simulation et jeux" },
  { motif: "restaurant|resto|brasserie|mcdo|mcdonald|burger king|kfc|uber ?eats|deliveroo|just eat|boulangerie|cafe", categorie: "Restaurants et sorties" },
  { motif: "pharmacie|medecin|docteur|dentiste|doctolib|mutuelle|hopital|kine|opticien", categorie: "Santé" },
  { motif: "amazon|fnac|darty|boulanger|ldlc|cdiscount|ikea|leroy merlin|castorama|decathlon|action\\b", categorie: "Achats" },
  { motif: "assurance|maif|macif|axa|allianz|matmut|groupama|mma", categorie: "Assurances" },
  { motif: "impot|dgfip|tresor public|taxe", categorie: "Impôts" },
  { motif: "retrait|dab|distributeur", categorie: "Retraits" },
  { motif: "virement (vers|a destination)|vir sepa|epargne|livret", categorie: "Virements et épargne" },
  { motif: "frais|cotisation carte|commission|agios", categorie: "Frais bancaires" },
];

function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** « 1 234,56 », « -12.30 », « 12,30 € » → nombre. */
export function parseAmount(raw: string): number | undefined {
  const text = raw.replace(/[€\s ]/g, "").replace(/^\+/, "");
  if (!text) return undefined;
  const normalized = /,\d{1,2}$/.test(text) ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

/** « 12/11/2026 », « 2026-11-12 », « 12/11/26 » → AAAA-MM-JJ. */
export function parseBankDate(raw: string): string | undefined {
  const t = raw.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) return `${m[3]!.length === 2 ? `20${m[3]}` : m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return undefined;
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(field.trim());
      field = "";
    } else field += ch;
  }
  out.push(field.trim());
  return out;
}

/** Lit un export CSV de banque (colonnes Date, Libellé, Montant ou Débit/Crédit). */
export function parseBankCsv(text: string, compte?: string): Array<Omit<Operation, "id" | "categorie">> {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const sep = [";", ",", "\t"].map((s) => ({ s, n: (lines.slice(0, 10).join("\n").match(new RegExp(s === "\t" ? "\t" : `\\${s}`, "g")) ?? []).length })).sort((a, b) => b.n - a.n)[0]!.s;
  let header = -1;
  let cols = { date: -1, libelle: -1, montant: -1, debit: -1, credit: -1 };
  for (let i = 0; i < Math.min(lines.length, 30); i += 1) {
    const cells = splitCsvLine(lines[i]!, sep).map(fold);
    const find = (re: RegExp) => cells.findIndex((c) => re.test(c));
    const date = find(/^date( d'?operation| operation| de l'?operation|)$|^date/);
    const libelle = find(/libelle|description|intitule|nature|detail/);
    const montant = find(/^montant|^amount|^somme/);
    const debit = find(/debit/);
    const credit = find(/credit/);
    if (date !== -1 && libelle !== -1 && (montant !== -1 || debit !== -1 || credit !== -1)) {
      header = i;
      cols = { date, libelle, montant, debit, credit };
      break;
    }
  }
  if (header === -1) throw new Error("En-têtes du relevé non reconnus (il faut des colonnes Date, Libellé et Montant ou Débit/Crédit).");
  const ops: Array<Omit<Operation, "id" | "categorie">> = [];
  for (const line of lines.slice(header + 1)) {
    const cells = splitCsvLine(line, sep);
    const date = parseBankDate(cells[cols.date] ?? "");
    if (!date) continue;
    let montant: number | undefined;
    if (cols.montant !== -1) montant = parseAmount(cells[cols.montant] ?? "");
    else {
      const debit = parseAmount(cells[cols.debit] ?? "") ?? 0;
      const credit = parseAmount(cells[cols.credit] ?? "") ?? 0;
      montant = credit - Math.abs(debit);
    }
    if (montant === undefined) continue;
    ops.push({ date, libelle: (cells[cols.libelle] ?? "").replace(/\s+/g, " ").trim(), montant: Math.round(montant * 100) / 100, ...(compte ? { compte } : {}) });
  }
  return ops;
}

export function categorize(libelle: string, montant: number, rules: Rule[]): string {
  const text = fold(libelle);
  for (const rule of rules) {
    try {
      if (new RegExp(rule.motif, "i").test(text)) return rule.categorie;
    } catch {
      if (text.includes(fold(rule.motif))) return rule.categorie;
    }
  }
  return montant > 0 ? "Autres entrées" : "À classer";
}

interface BudgetState {
  operations: Operation[];
  regles: Rule[];
  fichiers: string[];
}

export class Budget {
  private readonly store: JsonStore<BudgetState>;

  constructor(dataDir: string) {
    this.store = new JsonStore(dataDir, "budget", () => ({ operations: [], regles: [], fichiers: [] }));
  }

  private rules(): Rule[] {
    return [...this.store.read().regles, ...DEFAULT_RULES];
  }

  /** Importe un relevé ; les opérations déjà connues ne sont pas doublées. */
  async importFile(file: string, compte?: string): Promise<{ ajoutees: number; total: number }> {
    const buffer = await readFile(file);
    const text = buffer.includes(0xc3) || !buffer.includes(0xe9) ? buffer.toString("utf8") : buffer.toString("latin1");
    return this.importText(text, compte, file);
  }

  importText(text: string, compte?: string, source?: string): { ajoutees: number; total: number } {
    const parsed = parseBankCsv(text, compte);
    const rules = this.rules();
    const state = this.store.read();
    const known = new Set(state.operations.map((o) => o.id));
    const counts = new Map<string, number>();
    const added: Operation[] = [];
    for (const op of parsed) {
      const base = `${op.date}|${op.libelle}|${op.montant}|${op.compte ?? ""}`;
      const n = (counts.get(base) ?? 0) + 1;
      counts.set(base, n);
      const id = createHash("sha1").update(`${base}|${n}`).digest("hex").slice(0, 16);
      if (known.has(id)) continue;
      known.add(id);
      added.push({ ...op, id, categorie: categorize(op.libelle, op.montant, rules) });
    }
    this.store.update((s) => ({ ...s, operations: [...s.operations, ...added].sort((a, b) => a.date.localeCompare(b.date)), fichiers: source ? [...new Set([...s.fichiers, source])] : s.fichiers }));
    return { ajoutees: added.length, total: parsed.length };
  }

  imported(): string[] {
    return this.store.read().fichiers;
  }

  /** Nouvelle règle (« tout ce qui contient FANATEC va en Simulation »), appliquée aussi au passé. */
  addRule(motif: string, categorie: string): number {
    let changed = 0;
    this.store.update((s) => {
      const regles = [{ motif, categorie }, ...s.regles.filter((r) => r.motif !== motif)];
      const all = [...regles, ...DEFAULT_RULES];
      const operations = s.operations.map((o) => {
        const c = categorize(o.libelle, o.montant, all);
        if (c !== o.categorie) changed += 1;
        return { ...o, categorie: c };
      });
      return { ...s, regles, operations };
    });
    return changed;
  }

  operations(filter: { mois?: string; categorie?: string; recherche?: string } = {}): Operation[] {
    return this.store.read().operations.filter((o) => (!filter.mois || o.date.startsWith(filter.mois)) && (!filter.categorie || fold(o.categorie) === fold(filter.categorie)) && (!filter.recherche || fold(o.libelle).includes(fold(filter.recherche))));
  }

  /** Bilan d'un mois (AAAA-MM) : entrées, sorties, solde, par catégorie, comparé à la moyenne des 3 mois précédents. */
  summary(month: string): { mois: string; entrees: number; sorties: number; solde: number; categories: Array<{ categorie: string; total: number; moyenne3mois: number; ecart: number }>; plusGrosses: Operation[]; aClasser: number } {
    const ops = this.operations({ mois: month });
    const round = (n: number) => Math.round(n * 100) / 100;
    const prevMonths = [1, 2, 3].map((k) => {
      const [y, m] = month.split("-").map(Number) as [number, number];
      const d = new Date(Date.UTC(y, m - 1 - k, 1));
      return d.toISOString().slice(0, 7);
    });
    const byCat = (list: Operation[]) => {
      const map = new Map<string, number>();
      for (const o of list) if (o.montant < 0) map.set(o.categorie, (map.get(o.categorie) ?? 0) - o.montant);
      return map;
    };
    const current = byCat(ops);
    const previous = prevMonths.map((m) => byCat(this.operations({ mois: m })));
    const monthsWithData = previous.filter((p) => p.size > 0).length || 1;
    const categories = [...current.entries()]
      .map(([categorie, total]) => {
        const moyenne3mois = previous.reduce((a, p) => a + (p.get(categorie) ?? 0), 0) / monthsWithData;
        return { categorie, total: round(total), moyenne3mois: round(moyenne3mois), ecart: round(total - moyenne3mois) };
      })
      .sort((a, b) => b.total - a.total);
    const entrees = round(ops.filter((o) => o.montant > 0).reduce((a, o) => a + o.montant, 0));
    const sorties = round(-ops.filter((o) => o.montant < 0).reduce((a, o) => a + o.montant, 0));
    return { mois: month, entrees, sorties, solde: round(entrees - sorties), categories, plusGrosses: [...ops].filter((o) => o.montant < 0).sort((a, b) => a.montant - b.montant).slice(0, 5), aClasser: ops.filter((o) => o.categorie === "À classer").length };
  }
}
