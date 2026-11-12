import type { Shift } from "./planning.js";

/**
 * Heure du réveil : d'après le planning (début du poste moins le temps de
 * préparation), sinon l'heure par défaut les jours choisis ; un réglage pour un
 * jour précis (« réveille-moi à 6 h 30 demain », « pas de réveil demain ») passe
 * avant tout.
 */

export interface AlarmRules {
  /** Minutes entre le réveil et le début du poste. */
  avantTravailMin: number;
  /** Réveil sans information du planning (« 07:45 »), ou undefined pour aucun. */
  heureParDefaut?: string | undefined;
  /** Jours du réveil par défaut : 1 = lundi … 7 = dimanche. */
  joursParDefaut: number[];
  /** Jours de repos du planning : « aucun » ou une heure (« 09:30 »). */
  repos: "aucun" | string;
  /** Jamais avant cette heure (« 05:00 »). */
  auPlusTot: string;
}

export interface AlarmOverride {
  date: string;
  heure?: string;
  aucun?: boolean;
}

export interface NextAlarm {
  at: Date;
  date: string;
  heure: string;
  raison: string;
  shift?: Shift;
}

export const DEFAULT_RULES: AlarmRules = { avantTravailMin: 75, heureParDefaut: "07:45", joursParDefaut: [1, 2, 3, 4, 5], repos: "aucun", auPlusTot: "05:00" };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date et heure locales (fuseau d'Alex) d'un instant. */
export function zonedParts(at: Date, timeZone: string): { date: string; heure: string; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday!) + 1;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, heure: `${parts.hour}:${parts.minute}`, weekday };
}

/** Instant correspondant à une date et une heure locales dans un fuseau (gère l'heure d'été). */
export function zonedTime(date: string, heure: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = heure.split(":").map(Number) as [number, number];
  const wanted = Date.UTC(y, m - 1, d, h, mi);
  let guess = wanted;
  for (let i = 0; i < 3; i += 1) {
    const p = zonedParts(new Date(guess), timeZone);
    const [py, pm, pd] = p.date.split("-").map(Number) as [number, number, number];
    const [ph, pmi] = p.heure.split(":").map(Number) as [number, number];
    const shown = Date.UTC(py, pm - 1, pd, ph, pmi);
    guess += wanted - shown;
  }
  return new Date(guess);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function minusMinutes(heure: string, minutes: number): string {
  const [h, m] = heure.split(":").map(Number) as [number, number];
  const total = Math.max(0, h * 60 + m - minutes);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function later(a: string, b: string): string {
  return a > b ? a : b;
}

/** Heure de réveil prévue pour un jour, et pourquoi. */
export function alarmForDay(date: string, weekday: number, shift: Shift | undefined, rules: AlarmRules, override?: AlarmOverride): { heure: string; raison: string } | undefined {
  if (override?.aucun) return undefined;
  if (override?.heure) return { heure: override.heure, raison: "réglé à la demande" };
  if (shift?.repos) return rules.repos === "aucun" ? undefined : { heure: rules.repos, raison: `repos (${shift.libelle ?? "planning"})` };
  if (shift?.debut) return { heure: later(minusMinutes(shift.debut, rules.avantTravailMin), rules.auPlusTot), raison: `poste à ${sayTime(shift.debut)}` };
  if (shift && !shift.debut && rules.heureParDefaut) return { heure: rules.heureParDefaut, raison: "jour travaillé (heure par défaut)" };
  if (rules.heureParDefaut && rules.joursParDefaut.includes(weekday)) return { heure: rules.heureParDefaut, raison: "heure habituelle" };
  return undefined;
}

/** Prochain réveil à partir de maintenant (sur 8 jours). */
export function nextAlarm(now: Date, timeZone: string, shifts: Shift[], rules: AlarmRules, overrides: AlarmOverride[] = [], firedDates: string[] = []): NextAlarm | undefined {
  const today = zonedParts(now, timeZone);
  for (let i = 0; i < 8; i += 1) {
    const date = addDays(today.date, i);
    if (firedDates.includes(date)) continue;
    const weekday = ((today.weekday - 1 + i) % 7) + 1;
    const shift = shifts.find((s) => s.date === date);
    const plan = alarmForDay(date, weekday, shift, rules, overrides.find((o) => o.date === date));
    if (!plan) continue;
    const at = zonedTime(date, plan.heure, timeZone);
    if (at.getTime() <= now.getTime() - 60_000) continue;
    return { at, date, heure: plan.heure, raison: plan.raison, ...(shift ? { shift } : {}) };
  }
  return undefined;
}

/** « 1-5 », « 1,2,3,4,5,6 », « lun-ven » → jours de la semaine. */
export function parseDays(raw: string | undefined): number[] {
  if (!raw?.trim()) return [1, 2, 3, 4, 5];
  const names: Record<string, number> = { lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 7 };
  const value = (s: string) => names[s.trim().toLowerCase().slice(0, 3)] ?? Number(s);
  const days = new Set<number>();
  for (const part of raw.split(",")) {
    const [a, b] = part.split("-");
    const from = value(a ?? "");
    const to = b !== undefined ? value(b) : from;
    for (let d = from; Number.isFinite(d) && d <= to && d <= 7; d += 1) if (d >= 1) days.add(d);
  }
  return [...days].sort();
}

/** Heure à dire : « 7 h 45 ». */
export function sayTime(heure: string): string {
  const [h, m] = heure.split(":").map(Number) as [number, number];
  return m === 0 ? `${h} heures` : `${h} h ${pad(m)}`;
}
