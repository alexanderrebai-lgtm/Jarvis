import { describe, expect, it } from "vitest";
import type { Memoire, Note } from "@muscu/jarvis/src/notes.js";
import {
  REGLAGE_DEFAUT,
  candidatsBoucles,
  candidatsContexteRdv,
  candidatsEchos,
  choisir,
  estBoucleOuverte,
  motsCles,
  type EventLite,
  type RecallCandidate,
  type RecallReglage,
} from "../src/main/recall.js";

const note = (over: Partial<Note> = {}): Note => ({ id: "note_1", texte: "", tags: [], creeLe: "2026-11-01T10:00:00Z", ...over });
const mem = (over: Partial<Memoire> = {}): Memoire => ({ id: "mem_1", fait: "", creeLe: "2026-11-01T10:00:00Z", ...over });
const TZ = "Europe/Paris";

describe("recall : détection des boucles ouvertes", () => {
  it("repère une intention non terminée", () => {
    expect(estBoucleOuverte(note({ texte: "Je dois rappeler le garage pour la 107" }))).toBe(true);
    expect(estBoucleOuverte(note({ texte: "Penser à commander les plaquettes de frein" }))).toBe(true);
    expect(estBoucleOuverte(note({ texte: "Il fait beau aujourd'hui" }))).toBe(false);
  });

  it("ignore les notes qui ont déjà un rappel explicite", () => {
    expect(estBoucleOuverte(note({ texte: "Je dois appeler Léa", rappelLe: "2026-11-20T09:00:00Z" }))).toBe(false);
  });
});

describe("recall : candidats boucles mûres", () => {
  const now = new Date("2026-11-22T14:00:00Z");
  it("ressort une note de quelques jours, pas une trop fraîche ni trop vieille", () => {
    const recente = note({ id: "a", texte: "Je dois ranger le garage", creeLe: "2026-11-22T12:00:00Z" }); // 2 h
    const mure = note({ id: "b", texte: "Je dois rappeler le garage", creeLe: "2026-11-19T10:00:00Z" }); // ~3 j
    const vieille = note({ id: "c", texte: "Je dois trier les papiers", creeLe: "2026-09-01T10:00:00Z" }); // > 21 j
    const out = candidatsBoucles([recente, mure, vieille], now);
    expect(out.map((c) => c.cle)).toEqual(["boucle:b"]);
    expect(out[0]!.texte).toContain("rappeler le garage");
  });
});

describe("recall : contexte avant un rendez-vous", () => {
  const now = new Date("2026-11-22T14:00:00Z");
  const events: EventLite[] = [{ id: "ev1", summary: "Rendez-vous garage Peugeot", start: "2026-11-22T15:00:00Z" }];
  it("relie une note au rendez-vous imminent par mots-clés", () => {
    const notes = [note({ texte: "Au garage, demander le devis pour la courroie de distribution" })];
    const out = candidatsContexteRdv(events, notes, [], now);
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe("contexte-rdv");
    expect(out[0]!.texte).toContain("courroie");
    expect(out[0]!.score).toBeGreaterThan(candidatsBoucles(notes, now)[0]?.score ?? 0);
  });

  it("n'invente rien si aucune note ne correspond", () => {
    expect(candidatsContexteRdv(events, [note({ texte: "acheter du pain" })], [], now)).toHaveLength(0);
  });

  it("ignore un rendez-vous trop lointain", () => {
    const loin: EventLite[] = [{ id: "ev2", summary: "garage Peugeot", start: "2026-11-24T15:00:00Z" }];
    expect(candidatsContexteRdv(loin, [note({ texte: "garage: devis" })], [], now)).toHaveLength(0);
  });
});

describe("recall : mots-clés", () => {
  it("garde les mots porteurs, enlève les mots vides et courts", () => {
    expect(motsCles("Rendez-vous avec le garage pour la courroie")).toContain("courroie");
    expect(motsCles("Rendez-vous avec le garage pour la courroie")).toContain("garage");
    expect(motsCles("avec le pour la")).toEqual([]);
  });
});

describe("recall : échos d'il y a un an", () => {
  it("ressort un fait daté d'il y a pile un an", () => {
    const now = new Date("2026-11-22T12:00:00Z");
    const out = candidatsEchos([mem({ fait: "j'ai commencé la musculation", creeLe: "2025-11-21T12:00:00Z" })], now);
    expect(out).toHaveLength(1);
    expect(out[0]!.texte).toContain("1 an");
  });
  it("ignore un fait récent", () => {
    const now = new Date("2026-11-22T12:00:00Z");
    expect(candidatsEchos([mem({ creeLe: "2026-10-01T12:00:00Z" })], now)).toHaveLength(0);
  });
});

describe("recall : le garde-fou anti-harcèlement", () => {
  const cand: RecallCandidate[] = [{ cle: "boucle:x", source: "boucle", score: 50, texte: "pense à X" }];
  const state = () => ({ historique: {}, parJour: {}, recents: [] });
  const midi = new Date("2026-11-22T11:00:00Z"); // 12 h à Paris

  it("sort le candidat le mieux noté aux heures normales", () => {
    const deux: RecallCandidate[] = [...cand, { cle: "rdv:y", source: "contexte-rdv", score: 110, texte: "avant ton rdv" }];
    expect(choisir(deux, state(), REGLAGE_DEFAUT, midi, TZ).emis?.cle).toBe("rdv:y");
  });

  it("se tait en dehors des heures choisies", () => {
    const nuit = new Date("2026-11-22T02:00:00Z"); // 3 h à Paris
    expect(choisir(cand, state(), REGLAGE_DEFAUT, nuit, TZ).silence).toBe("heures calmes");
  });

  it("se tait quand le quota du jour est atteint", () => {
    const s = { ...state(), parJour: { "2026-11-22": REGLAGE_DEFAUT.maxParJour } };
    expect(choisir(cand, s, REGLAGE_DEFAUT, midi, TZ).silence).toBe("quota du jour atteint");
  });

  it("respecte l'intervalle minimum entre deux rappels", () => {
    const s = { ...state(), dernierEnvoi: new Date(midi.getTime() - 10 * 60_000).toISOString() };
    expect(choisir(cand, s, REGLAGE_DEFAUT, midi, TZ).silence).toBe("trop tôt après le dernier");
  });

  it("ne répète pas la même chose avant le délai, ni au-delà du maximum", () => {
    const recent = { ...state(), historique: { "boucle:x": { dernier: new Date(midi.getTime() - 86_400_000).toISOString(), fois: 1 } } };
    expect(choisir(cand, recent, REGLAGE_DEFAUT, midi, TZ).silence).toBe("rien de nouveau à dire");
    const epuise = { ...state(), historique: { "boucle:x": { dernier: "2026-01-01T00:00:00Z", fois: REGLAGE_DEFAUT.maxRepetitions } } };
    expect(choisir(cand, epuise, REGLAGE_DEFAUT, midi, TZ).silence).toBe("rien de nouveau à dire");
  });

  it("ne dit rien quand la fonction est désactivée", () => {
    const off: RecallReglage = { ...REGLAGE_DEFAUT, actif: false };
    expect(choisir(cand, state(), off, midi, TZ).silence).toBe("désactivé");
  });
});
