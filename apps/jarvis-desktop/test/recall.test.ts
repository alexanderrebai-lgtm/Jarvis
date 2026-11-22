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

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NotesRepository } from "@muscu/jarvis/src/notes.js";
import { RecallEngine, estResolue, racinesCommunes } from "../src/main/recall.js";

describe("recall : racines, boucles résolues", () => {
  it("rapproche les formes d'un même mot", () => {
    expect(racinesCommunes("courroie de distribution", "devis pour les courroies")).toBeGreaterThanOrEqual(1);
    expect(racinesCommunes("rappeler le garage", "rappel garage demain")).toBeGreaterThanOrEqual(2);
    expect(racinesCommunes("acheter du pain", "garage peugeot")).toBe(0);
  });

  it("ne relance pas une intention déjà réalisée depuis", () => {
    const boucle = note({ id: "b", texte: "Je dois rappeler le garage pour le devis", creeLe: "2026-11-19T10:00:00Z" });
    const plusTard = [{ texte: "J'ai rappelé le garage, le devis est ok", creeLe: "2026-11-20T09:00:00Z" }];
    expect(estResolue(boucle, plusTard)).toBe(true);
    expect(estResolue(boucle, [{ texte: "Rappeler Léa demain", creeLe: "2026-11-20T09:00:00Z" }])).toBe(false);
    const now = new Date("2026-11-22T14:00:00Z");
    expect(candidatsBoucles([boucle, note({ id: "c", texte: "J'ai rappelé le garage, le devis est ok", creeLe: "2026-11-20T09:00:00Z" })], now)).toHaveLength(0);
  });
});

describe("recall : apprend de tes 👍 / 👎", () => {
  const cand: RecallCandidate[] = [
    { cle: "boucle:a", source: "boucle", score: 50, texte: "A" },
    { cle: "echo:b", source: "echo", score: 49, texte: "B" },
  ];
  const midi = new Date("2026-11-22T11:00:00Z"); // 12 h à Paris
  const vide = () => ({ historique: {}, parJour: {}, recents: [], retours: {}, stats: {} });

  it("ne ressort jamais un rappel jugé inutile", () => {
    const s = { ...vide(), retours: { "boucle:a": "inutile" as const } };
    expect(choisir(cand, s, REGLAGE_DEFAUT, midi, TZ).emis?.cle).toBe("echo:b");
  });

  it("favorise la catégorie appréciée et coupe celle qu'il juge inutile", () => {
    const aime = { ...vide(), stats: { "source:echo": { utile: 6, inutile: 0 }, "source:boucle": { utile: 0, inutile: 1 } } };
    expect(choisir(cand, aime, REGLAGE_DEFAUT, midi, TZ).emis?.cle).toBe("echo:b");
    const rejette = { ...vide(), stats: { "source:boucle": { utile: 0, inutile: 6 } } };
    expect(choisir(cand, rejette, REGLAGE_DEFAUT, midi, TZ).emis?.cle).toBe("echo:b");
  });

  it("se tait à une heure qui l'agace", () => {
    const s = { ...vide(), stats: { "heure:12": { utile: 0, inutile: 4 } } };
    expect(choisir(cand, s, REGLAGE_DEFAUT, midi, TZ).silence).toBe("heure peu appréciée");
  });

  it("le moteur enregistre l'avis, l'affiche, et accepte un changement d'avis", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "recall-"));
    const notes = new NotesRepository(dir, () => new Date("2026-11-22T11:00:00Z"));
    notes.add("Je dois rappeler le garage", []);
    const dits: string[] = [];
    const engine = new RecallEngine({
      dataDir: dir, timeZone: TZ, notes, agenda: undefined, reglage: { ...REGLAGE_DEFAUT, calmeAvant: 0, calmeApres: 24 },
      say: (t) => dits.push(t), notify: () => undefined, canSpeak: () => true,
      now: () => new Date("2026-11-22T20:00:00Z"),
    });
    // la note a ~9 h : assez mûre
    const emis = await engine.tick();
    expect(emis?.source).toBe("boucle");
    expect(engine.retour(emis!.cle, "utile")).toBe(true);
    expect(engine.recents()[0]!.avis).toBe("utile");
    expect(engine.retour(emis!.cle, "inutile")).toBe(true);
    expect(engine.recents()[0]!.avis).toBe("inutile");
    expect(engine.retour("inconnu", "utile")).toBe(false);
  });
});

describe("recall : rapprochement par le sens (modèle local simulé)", () => {
  it("retrouve la note liée au rendez-vous même sans mot en commun", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "recall-sens-"));
    const now = new Date("2026-11-22T14:00:00Z");
    const notes = new NotesRepository(dir, () => new Date("2026-11-10T10:00:00Z"));
    notes.add("Demander le prix de la révision des freins", []);
    notes.add("Idée de cadeau pour Léa", []);
    // faux modèle : « dentiste » est proche de « révision des freins » par construction du test
    const vec = (texte: string) => (/dentiste|freins/i.test(texte) ? Float32Array.from([1, 0]) : Float32Array.from([0, 1]));
    const embedder = { embed: async (texts: string[]) => texts.map(vec) };
    const agenda = { list: async () => [{ id: "ev9", summary: "Dentiste", start: "2026-11-22T15:00:00Z" }] };
    const engine = new RecallEngine({
      dataDir: dir, timeZone: TZ, notes, agenda: agenda as never, reglage: { ...REGLAGE_DEFAUT, calmeAvant: 0, calmeApres: 24 },
      say: () => undefined, notify: () => undefined, canSpeak: () => true, embedder, now: () => now,
    });
    const emis = await engine.tick();
    expect(emis?.source).toBe("contexte-rdv");
    expect(emis?.texte).toContain("révision des freins");
  });
});
