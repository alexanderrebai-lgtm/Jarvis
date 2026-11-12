import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Lecture du planning de travail (Excel ou CSV) pour régler le réveil.
 * Formats reconnus sans aide : grille personnes × jours (« 08:30-16:30 »,
 * codes M/S/RH…), grille jours × personnes, ou liste « date / début / fin ».
 * Si rien n'est reconnu, Jarvis demande à Claude de lire le tableau (les noms
 * des collègues sont alors remplacés par des pseudonymes).
 */

export type Cell = string | number | Date | null;

export interface Grid {
  sheet: string;
  rows: Cell[][];
}

export interface Shift {
  /** Jour au format AAAA-MM-JJ. */
  date: string;
  debut?: string;
  fin?: string;
  repos: boolean;
  libelle?: string;
}

const REST_CODES = ["rh", "r", "repos", "off", "cp", "rtt", "conge", "conges", "ca", "ferie", "f", "mal", "maladie", "am", "abs", "absent", "x", "-", "rc", "rec", "jf", "rcn"];

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function hhmm(h: number, m: number): string | undefined {
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return undefined;
  return `${pad(h)}:${pad(m)}`;
}

/** Valeur brute d'une cellule ExcelJS (formules, texte riche, liens). */
export function cellValue(raw: unknown): Cell {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" || typeof raw === "number") return raw;
  if (raw instanceof Date) return raw;
  if (typeof raw === "boolean") return raw ? "vrai" : "faux";
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if ("result" in o) return cellValue(o.result);
    if (Array.isArray(o.richText)) return (o.richText as Array<{ text: string }>).map((t) => t.text).join("");
    if (typeof o.text === "string") return o.text;
    if ("error" in o) return null;
  }
  return String(raw);
}

/** Heure contenue dans une cellule : « 8h », « 08:30 », 0,354 (fraction de jour), Date 1899-12-30T08:30. */
export function parseTime(value: Cell): string | undefined {
  if (value === null) return undefined;
  if (value instanceof Date) {
    if (value.getUTCFullYear() <= 1900) return hhmm(value.getUTCHours(), value.getUTCMinutes());
    return undefined;
  }
  if (typeof value === "number") {
    if (value > 0 && value < 1) {
      const minutes = Math.round(value * 1440);
      return hhmm(Math.floor(minutes / 60), minutes % 60);
    }
    return undefined;
  }
  const m = value.trim().match(/^(\d{1,2})\s*(?:h|:|\.)\s*(\d{2})?\s*$/i);
  return m ? hhmm(Number(m[1]), Number(m[2] ?? 0)) : undefined;
}

/**
 * Contenu d'une case de planning : « 08:30-16:30 », « 8h-16h », « 9h à 17h30 »,
 * « RH », « CP », ou un code défini par Alex (M=08:00-15:00).
 */
export function parseShiftCell(value: Cell, codes: Record<string, string> = {}): Omit<Shift, "date"> | undefined {
  if (value === null) return undefined;
  if (value instanceof Date || typeof value === "number") {
    const t = parseTime(value);
    return t ? { debut: t, repos: false } : undefined;
  }
  const raw = value.trim();
  if (!raw) return undefined;
  const text = normalizeText(raw);
  const code = Object.entries(codes).find(([k]) => normalizeText(k) === text);
  if (code) return parseShiftCell(code[1], {}) ? { ...parseShiftCell(code[1], {})!, libelle: raw } : undefined;
  if (REST_CODES.includes(text.replace(/[.\s]/g, "")) || /^(repos|conges?|ferie|off|maladie|absent|rtt)\b/.test(text)) return { repos: true, libelle: raw };
  const range = text.match(/(\d{1,2})\s*(?:h|:)\s*(\d{2})?\s*(?:-|–|—|a|>|\/|jusqu'?a)\s*(\d{1,2})\s*(?:h|:)?\s*(\d{2})?/);
  if (range) {
    const debut = hhmm(Number(range[1]), Number(range[2] ?? 0));
    const fin = hhmm(Number(range[3]), Number(range[4] ?? 0));
    if (debut) return { debut, ...(fin ? { fin } : {}), repos: false, ...(raw.length > 13 ? { libelle: raw } : {}) };
  }
  const single = parseTime(raw);
  if (single) return { debut: single, repos: false };
  return undefined;
}

const MONTHS: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1, fevrier: 2, fevr: 2, fev: 2, mars: 3, mar: 3, avril: 4, avr: 4, mai: 5, juin: 6, juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, sep: 9, octobre: 10, oct: 10, novembre: 11, nov: 11, decembre: 12, dec: 12,
};

function isoDate(y: number, m: number, d: number): string | undefined {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Année la plus plausible pour un jour sans année : la plus proche d'aujourd'hui. */
function guessYear(m: number, d: number, today: Date): number {
  const y = today.getUTCFullYear();
  const candidates = [y - 1, y, y + 1];
  let best = y;
  let bestGap = Infinity;
  for (const c of candidates) {
    const gap = Math.abs(Date.UTC(c, m - 1, d) - today.getTime());
    if (gap < bestGap) {
      bestGap = gap;
      best = c;
    }
  }
  return best;
}

/** Date contenue dans une cellule : Date Excel, numéro de série, « 13/11 », « lun. 13/11/2026 », « 13 novembre », « 2026-11-13 ». */
export function parseDate(value: Cell, today = new Date()): string | undefined {
  if (value === null) return undefined;
  if (value instanceof Date) {
    if (value.getUTCFullYear() <= 1900) return undefined;
    return isoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === "number") {
    // Numéro de série Excel (jours depuis le 30/12/1899).
    if (value > 35000 && value < 80000 && Number.isInteger(value)) {
      const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
      return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }
    return undefined;
  }
  const text = normalizeText(value);
  let m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = text.match(/(?:^|\D)(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?:\D|$)/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : guessYear(mo, d, today);
    return isoDate(y, mo, d);
  }
  m = text.match(/(?:^|\D)(\d{1,2})(?:er)?\s+([a-z]+)\.?(?:\s+(\d{4}))?/);
  if (m && MONTHS[m[2]!]) {
    const mo = MONTHS[m[2]!]!;
    const d = Number(m[1]);
    return isoDate(m[3] ? Number(m[3]) : guessYear(mo, d, today), mo, d);
  }
  return undefined;
}

function matchesOwner(value: Cell, owners: string[]): boolean {
  if (typeof value !== "string") return false;
  const text = normalizeText(value);
  return owners.some((o) => {
    const n = normalizeText(o);
    return n.length >= 2 && (text === n || new RegExp(`(^|[^a-z])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(text));
  });
}

/** Grille personnes (lignes) × jours (colonnes). */
function fromPeopleRows(grid: Grid, owners: string[], codes: Record<string, string>, today: Date): Shift[] {
  const rows = grid.rows;
  for (let r = 0; r < Math.min(rows.length, 40); r += 1) {
    const dates = rows[r]!.map((c) => parseDate(c, today));
    const dateCols = dates.map((d, c) => (d ? c : -1)).filter((c) => c >= 0);
    if (dateCols.length < 2) continue;
    for (let rr = r + 1; rr < rows.length; rr += 1) {
      const row = rows[rr]!;
      if (!row.slice(0, Math.max(1, dateCols[0]!)).some((c) => matchesOwner(c, owners))) continue;
      const shifts: Shift[] = [];
      for (const c of dateCols) {
        const parsed = parseShiftCell(row[c] ?? null, codes);
        // Format sur deux lignes : début sur la ligne d'Alex, fin juste en dessous.
        if (parsed && !parsed.repos && !parsed.fin) {
          const below = parseTime(rows[rr + 1]?.[c] ?? null);
          if (below && !rows[rr + 1]!.slice(0, dateCols[0]!).some((cell) => typeof cell === "string" && cell.trim())) parsed.fin = below;
        }
        if (parsed) shifts.push({ date: dates[c]!, ...parsed });
      }
      if (shifts.length) return shifts;
    }
  }
  return [];
}

/** Grille jours (lignes) × personnes (colonnes). */
function fromPeopleColumns(grid: Grid, owners: string[], codes: Record<string, string>, today: Date): Shift[] {
  const rows = grid.rows;
  for (let r = 0; r < Math.min(rows.length, 30); r += 1) {
    const col = rows[r]!.findIndex((c) => matchesOwner(c, owners));
    if (col === -1) continue;
    const shifts: Shift[] = [];
    for (let rr = r + 1; rr < rows.length; rr += 1) {
      const row = rows[rr]!;
      const date = row.slice(0, Math.max(1, col)).map((c) => parseDate(c, today)).find(Boolean);
      if (!date) continue;
      const parsed = parseShiftCell(row[col] ?? null, codes);
      if (parsed) shifts.push({ date, ...parsed });
    }
    if (shifts.length) return shifts;
  }
  return [];
}

/** Liste : une ligne par jour, avec des colonnes Date / Début / Fin (et parfois Nom). */
function fromList(grid: Grid, owners: string[], codes: Record<string, string>, today: Date): Shift[] {
  const rows = grid.rows;
  for (let r = 0; r < Math.min(rows.length, 20); r += 1) {
    const headers = rows[r]!.map((c) => (typeof c === "string" ? normalizeText(c) : ""));
    const dateCol = headers.findIndex((h) => /^(date|jour)\b/.test(h));
    const startCol = headers.findIndex((h) => /(debut|arrivee|prise de poste|embauche|^de$|horaire|heure)/.test(h));
    if (dateCol === -1 || startCol === -1) continue;
    const endCol = headers.findIndex((h, i) => i !== startCol && /(fin|depart|sortie|^a$)/.test(h));
    const nameCol = headers.findIndex((h) => /^(nom|conseiller|agent|salarie|collaborateur|prenom|personne)/.test(h));
    const shifts: Shift[] = [];
    for (let rr = r + 1; rr < rows.length; rr += 1) {
      const row = rows[rr]!;
      if (nameCol !== -1 && !matchesOwner(row[nameCol] ?? null, owners)) continue;
      const date = parseDate(row[dateCol] ?? null, today);
      if (!date) continue;
      const start = parseShiftCell(row[startCol] ?? null, codes);
      if (!start) continue;
      const end = endCol !== -1 ? parseTime(row[endCol] ?? null) : undefined;
      shifts.push({ date, ...start, ...(end && !start.fin ? { fin: end } : {}) });
    }
    if (shifts.length) return shifts;
  }
  return [];
}

/** Trouve les horaires d'Alex dans les feuilles du planning. */
export function extractShifts(grids: Grid[], owners: string[], options: { codes?: Record<string, string>; today?: Date } = {}): Shift[] {
  const today = options.today ?? new Date();
  const codes = options.codes ?? {};
  const byDate = new Map<string, Shift>();
  for (const grid of grids) {
    for (const strategy of [fromPeopleRows, fromPeopleColumns, fromList]) {
      const found = strategy(grid, owners, codes, today);
      if (found.length) {
        for (const s of found) if (!byDate.has(s.date)) byDate.set(s.date, s);
        break;
      }
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** « M=08:00-15:00, S=14:00-21:00 » → codes du planning. */
export function parseCodes(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (raw ?? "").split(",")) {
    const [k, v] = part.split("=").map((s) => s.trim());
    if (k && v) out[k] = v;
  }
  return out;
}

/** Noms qui figurent dans la première colonne d'une grille (pour les pseudonymes). */
export function peopleNames(grids: Grid[]): string[] {
  const names = new Set<string>();
  for (const grid of grids) {
    for (const row of grid.rows) {
      const first = row.slice(0, 2).find((c) => typeof c === "string" && /^[\p{L}][\p{L} '’-]{1,40}$/u.test(c.trim()));
      if (typeof first === "string" && !parseDate(first) && !parseShiftCell(first)) {
        const n = first.trim();
        if (!/^(nom|prenom|conseiller|equipe|total|semaine|date|jour|planning|agent|horaires?)$/i.test(normalizeText(n))) names.add(n);
      }
    }
  }
  return [...names];
}

/** Tableau en texte (pour que Claude le lise quand le format est inconnu). */
export function gridAsText(grid: Grid, maxRows = 80, maxCols = 40): string {
  const show = (c: Cell) => (c === null ? "" : c instanceof Date ? (c.getUTCFullYear() <= 1900 ? parseTime(c) ?? "" : c.toISOString().slice(0, 10)) : String(c).replace(/\s+/g, " ").trim());
  return `Feuille « ${grid.sheet} »\n${grid.rows
    .slice(0, maxRows)
    .map((row, i) => `${i + 1}\t${row.slice(0, maxCols).map(show).join("\t")}`)
    .join("\n")}`;
}

function parseCsv(text: string): Cell[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].map((s) => ({ s, n: firstLine.split(s).length })).sort((a, b) => b.n - a.n)[0]!.s;
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(field || null);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field || null);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field || null);
    rows.push(row);
  }
  return rows;
}

/** Lit toutes les feuilles d'un fichier .xlsx/.xlsm ou .csv. */
export async function readPlanningFile(file: string): Promise<Grid[]> {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".csv" || ext === ".txt") {
    const buffer = await readFile(file);
    const text = buffer.includes(0xc3) || !buffer.includes(0xe9) ? buffer.toString("utf8") : buffer.toString("latin1");
    return [{ sheet: path.basename(file), rows: parseCsv(text.replace(/^﻿/, "")) }];
  }
  if (ext === ".xls") throw new Error("Le format .xls (ancien Excel) n'est pas lu : enregistre le planning en .xlsx.");
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const grids: Grid[] = [];
  workbook.eachSheet((sheet) => {
    if (sheet.state && sheet.state !== "visible") return;
    const rows: Cell[][] = [];
    // Les cellules fusionnées n'ont de valeur que dans la première : on la recopie.
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const values: Cell[] = [];
      for (let c = 1; c <= Math.min(sheet.columnCount, 120); c += 1) {
        const cell = row.getCell(c);
        values.push(cellValue(cell.isMerged && cell.master ? cell.master.value : cell.value));
      }
      rows[rowNumber - 1] = values;
    });
    for (let i = 0; i < rows.length; i += 1) rows[i] ??= [];
    grids.push({ sheet: sheet.name, rows });
  });
  return grids;
}

export interface PlanningInfo {
  fichier: string;
  modifie: number;
  horaires: Shift[];
  methode: "automatique" | "claude" | "aucune";
  collegues: string[];
}

/** Planning en cache, relu seulement quand le fichier change. */
export class PlanningReader {
  private cache: PlanningInfo | undefined;

  constructor(
    private readonly options: {
      file: () => string | undefined;
      owners: string[];
      codes?: Record<string, string>;
      /** Repli : demande à Claude d'extraire les horaires d'un tableau inconnu. */
      askClaude?: (text: string) => Promise<Shift[]>;
      /** Masque les noms des collègues avant d'envoyer le tableau à Claude. */
      mask?: (text: string, names: string[]) => string;
    },
  ) {}

  async read(): Promise<PlanningInfo | undefined> {
    const file = this.options.file();
    if (!file) return undefined;
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) return undefined;
    if (this.cache && this.cache.fichier === file && this.cache.modifie === info.mtimeMs) return this.cache;
    const grids = await readPlanningFile(file);
    const collegues = peopleNames(grids).filter((n) => !this.options.owners.some((o) => normalizeText(n).includes(normalizeText(o))));
    let horaires = extractShifts(grids, this.options.owners, { ...(this.options.codes ? { codes: this.options.codes } : {}) });
    let methode: PlanningInfo["methode"] = horaires.length ? "automatique" : "aucune";
    if (!horaires.length && this.options.askClaude) {
      const text = grids.map((g) => gridAsText(g)).join("\n\n");
      const masked = this.options.mask ? this.options.mask(text, collegues) : text;
      horaires = (await this.options.askClaude(masked).catch(() => [])).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date));
      if (horaires.length) methode = "claude";
    }
    this.cache = { fichier: file, modifie: info.mtimeMs, horaires, methode, collegues };
    return this.cache;
  }

  /** Horaires d'un jour donné (AAAA-MM-JJ). */
  async shiftOn(date: string): Promise<Shift | undefined> {
    return (await this.read())?.horaires.find((s) => s.date === date);
  }
}
