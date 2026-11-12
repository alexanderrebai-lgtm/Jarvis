import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DispositionStore, parseDispositionCommand } from "../src/main/pages/dispositions.js";
import { findGames } from "../src/main/games.js";
import { addPages, computeLayout, shiftPlacement, splitColumns, swapPlacements, type DisplayInfo } from "../src/main/pages/layout.js";
import { PalmTracker } from "../src/shared/gestures.js";

const display = (id: number, x: number, primary = false): DisplayInfo => ({ id, primary, bounds: { x, y: 0, width: 1920, height: 1080 }, workArea: { x, y: 0, width: 1920, height: 1040 } });

describe("placement des pages", () => {
  it("coupe un seul écran en deux moitiés, la page de gauche à gauche", () => {
    const spots = computeLayout({ displays: [display(1, 0, true)], visible: [{ page: "rd", ecran: "droite" }, { page: "code", ecran: "gauche" }], home: { page: "accueil", ecran: "centre" } });
    const code = spots.find((s) => s.page === "code")!;
    const rd = spots.find((s) => s.page === "rd")!;
    expect(code.bounds).toEqual({ x: 0, y: 0, width: 960, height: 1040 });
    expect(rd.bounds.x).toBe(960);
    expect(spots.find((s) => s.page === "accueil")!.bounds.width).toBe(1920);
    expect(code.fullscreen).toBe(false);
  });

  it("trois pages sur un écran : des tiers sans trou", () => {
    const cols = splitColumns({ x: 0, y: 0, width: 1920, height: 1040 }, 3);
    expect(cols.map((c) => c.width).reduce((a, b) => a + b)).toBe(1920);
    expect(cols[2]!.x + cols[2]!.width).toBe(1920);
  });

  it("libère l'écran du milieu pendant une partie (trois écrans)", () => {
    const displays = [display(1, 0), display(2, 1920, true), display(3, 3840)];
    const spots = computeLayout({ displays, visible: [{ page: "ingenieur", ecran: "centre" }, { page: "performances", ecran: "droite" }], home: { page: "accueil", ecran: "centre" }, gameRunning: true });
    expect(spots.find((s) => s.page === "ingenieur")!.displayId).toBe(1);
    expect(spots.find((s) => s.page === "performances")!.displayId).toBe(3);
    expect(spots.every((s) => s.displayId !== 2)).toBe(true);
    expect(spots.find((s) => s.page === "ingenieur")!.fullscreen).toBe(true);
  });

  it("garde deux pages côte à côte sur un écran et cache la plus ancienne", () => {
    const first = addPages({ visible: [], requested: [{ page: "code", ecran: "droite" }], displayCount: 1 });
    const second = addPages({ visible: first.visible, requested: [{ page: "rd", ecran: "gauche" }], displayCount: 1 });
    expect(second.visible.map((v) => v.page)).toEqual(["code", "rd"]);
    const third = addPages({ visible: second.visible, requested: [{ page: "travail", ecran: "droite" }], displayCount: 1 });
    expect(third.visible.map((v) => v.page)).toEqual(["rd", "travail"]);
    expect(third.hidden).toEqual(["code"]);
  });

  it("répartit deux pages demandées ensemble sur des écrans différents", () => {
    const result = addPages({ visible: [], requested: [{ page: "travail", ecran: "droite" }, { page: "code", ecran: "droite" }], displayCount: 3 });
    expect(result.visible).toEqual([{ page: "travail", ecran: "droite" }, { page: "code", ecran: "gauche" }]);
    const replaced = addPages({ visible: result.visible, requested: [{ page: "securite", ecran: "droite" }], displayCount: 3 });
    expect(replaced.hidden).toEqual(["travail"]);
  });

  it("échange et décale les pages", () => {
    expect(swapPlacements([{ page: "code", ecran: "gauche" }, { page: "rd", ecran: "droite" }], 1)).toEqual([{ page: "rd", ecran: "gauche" }, { page: "code", ecran: "droite" }]);
    expect(swapPlacements([{ page: "code", ecran: "gauche" }], 3, "droite")).toEqual([{ page: "code", ecran: "centre" }]);
    expect(shiftPlacement([{ page: "code", ecran: "gauche" }, { page: "rd", ecran: "droite" }], "code", "droite", 2)).toEqual([{ page: "code", ecran: "droite" }, { page: "rd", ecran: "gauche" }]);
  });
});

describe("dispositions", () => {
  const store = () => new DispositionStore(mkdtempSync(path.join(tmpdir(), "dispo-")));

  it("propose course, atelier et bureau, modifiables", () => {
    const s = store();
    expect(s.list().map((d) => d.id)).toEqual(["course", "atelier", "bureau"]);
    s.save({ nom: "Atelier", pages: [{ page: "code", ecran: "gauche" }, { page: "rd", ecran: "centre" }, { page: "performances", ecran: "droite" }] });
    expect(s.get("atelier")!.pages).toHaveLength(3);
    s.save({ nom: "Soirée simu", pages: [{ page: "ingenieur", ecran: "droite" }], mots: ["soiree"] });
    expect(s.get("soirée simu")!.id).toBe("soiree-simu");
    expect(s.remove("bureau")).toBe(true);
    expect(() => s.save({ nom: "x", pages: [{ page: "inconnue", ecran: "gauche" }] })).toThrow();
    expect(() => s.save({ nom: "x", pages: [1, 2, 3, 4].map(() => ({ page: "code", ecran: "gauche" })) })).toThrow();
  });

  it("comprend « mode atelier », « passe en disposition course », « échange les écrans »", () => {
    const known = store().list();
    expect(parseDispositionCommand("Mode atelier", known)).toEqual({ action: "appliquer", nom: "Atelier" });
    expect(parseDispositionCommand("passe en mode course", known)).toEqual({ action: "appliquer", nom: "Course" });
    expect(parseDispositionCommand("active la disposition bureau", known)).toEqual({ action: "appliquer", nom: "Bureau" });
    expect(parseDispositionCommand("échange les écrans", known)).toEqual({ action: "echanger" });
    expect(parseDispositionCommand("garde cette disposition sous le nom soirée", known)).toEqual({ action: "enregistrer", nom: "soiree" });
    expect(parseDispositionCommand("mode avion", known)).toBeUndefined();
    expect(parseDispositionCommand("ouvre le code", known)).toBeUndefined();
  });
});

describe("jeu en cours", () => {
  it("reconnaît Le Mans Ultimate et F1 dans la liste des processus", () => {
    const csv = '"System Idle Process","0","Services","0","8 K"\r\n"Le Mans Ultimate.exe","4242","Console","1","3 512 000 K"\r\n"Spotify.exe","77","Console","1","210 000 K"';
    expect(findGames(csv, ["Le Mans Ultimate.exe", "F1_25.exe"])).toEqual(["Le Mans Ultimate.exe"]);
    expect(findGames('"F1_25.exe","1","Console","1","1 K"', ["Le Mans Ultimate.exe", "F1_25.exe"])).toEqual(["F1_25.exe"]);
  });
});

describe("main ouverte", () => {
  it("un balayage vers la droite d'Alex (vers la gauche de l'image)", () => {
    const t = new PalmTracker();
    let event;
    for (let i = 0; i <= 6; i += 1) event = t.push(true, 0.7 - i * 0.07, 0.5, i * 80) ?? event;
    expect(event).toBe("balayage-droite");
  });

  it("main immobile : stop, une seule fois", () => {
    const t = new PalmTracker();
    const events = [];
    for (let i = 0; i < 20; i += 1) events.push(t.push(true, 0.5 + (i % 2) * 0.01, 0.5, i * 90));
    expect(events.filter((e) => e === "stop")).toHaveLength(1);
    expect(events.includes("balayage-gauche")).toBe(false);
  });

  it("en miroir, le sens s'inverse", () => {
    const t = new PalmTracker({ mirrored: true });
    let event;
    for (let i = 0; i <= 6; i += 1) event = t.push(true, 0.7 - i * 0.07, 0.5, i * 80) ?? event;
    expect(event).toBe("balayage-gauche");
  });
});
