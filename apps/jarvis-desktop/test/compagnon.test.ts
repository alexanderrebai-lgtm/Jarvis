import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGUE, CompagnonStore, JeuxDetecteur, PROFILS, detecterJeux, dureeLisible, estGenre, genreDepuisNom, parsePerso, parseProcessus, phraseJeu, promptCoach } from "../src/main/compagnon.js";

const p = (name: string, chemin?: string) => (chemin ? { name, path: chemin } : { name });

describe("catalogue", () => {
  it("couvre les genres demandés : Call of Duty, EA FC, GTA, Flight Simulator, aventure, course", () => {
    const de = (nom: string) => CATALOGUE.find((j) => j.nom === nom)?.genre;
    expect(de("Call of Duty")).toBe("tir");
    expect(de("EA Sports FC")).toBe("sport");
    expect(de("GTA V")).toBe("monde-ouvert");
    expect(de("Microsoft Flight Simulator")).toBe("vol");
    expect(de("The Witcher 3")).toBe("aventure");
    expect(de("Le Mans Ultimate")).toBe("course");
  });

  it("n'a aucun processus en double entre deux jeux", () => {
    const vus = new Map<string, string>();
    for (const j of CATALOGUE) for (const proc of j.processus) {
      const cle = proc.toLowerCase();
      expect(vus.get(cle), `${proc} est dans ${vus.get(cle)} et ${j.nom}`).toBeUndefined();
      vus.set(cle, j.nom);
    }
  });

  it("chaque genre a un profil avec des actions rapides", () => {
    for (const j of CATALOGUE) expect(PROFILS[j.genre]).toBeDefined();
    for (const profil of Object.values(PROFILS)) expect(profil.actions.length).toBeGreaterThanOrEqual(3);
  });
});

describe("détection", () => {
  it("reconnaît un jeu du catalogue par son processus, sans tenir compte de la casse", () => {
    const jeux = detecterJeux([p("explorer.exe"), p("fc25.EXE"), p("gta5.exe")]);
    expect(jeux.map((j) => [j.nom, j.genre])).toEqual([["EA Sports FC", "sport"], ["GTA V", "monde-ouvert"]]);
  });

  it("reconnaît un jeu inconnu d'après son dossier de bibliothèque, avec un genre deviné", () => {
    const jeux = detecterJeux([
      p("Game-Win64-Shipping.exe", "D:\\SteamLibrary\\steamapps\\common\\Dirt Rally 2.0\\Game-Win64-Shipping.exe"),
      p("hades2.exe", "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hades II\\Ship\\hades2.exe"),
    ]);
    expect(jeux).toEqual([
      expect.objectContaining({ nom: "Dirt Rally 2.0", genre: "course", source: "dossier", lanceur: "Steam" }),
      expect.objectContaining({ nom: "Hades II", genre: "aventure", source: "dossier" }),
    ]);
  });

  it("repère les autres lanceurs (Epic, Ubisoft, Xbox, Rockstar)", () => {
    const jeux = detecterJeux([
      p("a.exe", "C:\\Program Files\\Epic Games\\Alan Wake 2\\a.exe"),
      p("b.exe", "C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games\\Far Cry 6\\b.exe"),
      p("c.exe", "C:\\XboxGames\\Forza Horizon 6\\Content\\c.exe"),
      p("d.exe", "C:\\Program Files\\Rockstar Games\\Max Payne 3\\d.exe"),
    ]);
    expect(jeux.map((j) => j.lanceur)).toEqual(["Epic Games", "Ubisoft", "Xbox", "Rockstar"]);
    expect(jeux.find((j) => j.nom === "Far Cry 6")?.genre).toBe("tir");
  });

  it("ignore les lanceurs, anti-triche, outils et programmes d'installation", () => {
    const jeux = detecterJeux([
      p("EpicWebHelper.exe", "C:\\Program Files\\Epic Games\\Fortnite\\EpicWebHelper.exe"),
      p("UnityCrashHandler64.exe", "D:\\steamapps\\common\\Some Game\\UnityCrashHandler64.exe"),
      p("vcredist.exe", "D:\\steamapps\\common\\Some Game\\vcredist.exe"),
      p("wallpaper64.exe", "D:\\steamapps\\common\\Wallpaper Engine\\wallpaper64.exe"),
      p("Steamworks.exe", "D:\\steamapps\\common\\Steamworks Shared\\x.exe"),
      p("chrome.exe", "C:\\Program Files\\Google\\Chrome\\chrome.exe"),
    ]);
    expect(jeux).toEqual([]);
  });

  it("ne double pas un jeu déjà connu par son nom et par son dossier", () => {
    const jeux = detecterJeux([p("eldenring.exe", "D:\\steamapps\\common\\ELDEN RING\\Game\\eldenring.exe"), p("start_protected_game.exe", "D:\\steamapps\\common\\ELDEN RING\\Game\\start_protected_game.exe")]);
    expect(jeux.map((j) => j.nom)).toEqual(["Elden Ring"]);
  });

  it("lit les jeux déclarés à la main", () => {
    const perso = parsePerso("Mon jeu=monjeu.exe=aventure ; Foot de quartier=foot.exe,foot64.exe=sport ; Sans genre=truc.exe");
    expect(perso).toHaveLength(3);
    expect(detecterJeux([p("FOOT64.exe")], perso)[0]).toMatchObject({ nom: "Foot de quartier", genre: "sport", source: "perso" });
    expect(perso[2]!.genre).toBe("autre");
  });

  it("devine le genre d'après le nom", () => {
    expect(genreDepuisNom("Microsoft Flight Simulator 2024")).toBe("vol");
    expect(genreDepuisNom("Call of Duty Black Ops")).toBe("tir");
    expect(genreDepuisNom("Football Manager 25")).toBe("sport");
    expect(genreDepuisNom("Un truc inconnu")).toBe("autre");
    expect(estGenre("tir")).toBe(true);
    expect(estGenre("n'importe quoi")).toBe(false);
  });

  it("lit la sortie de PowerShell comme celle de tasklist", () => {
    const procs = parseProcessus('"chrome.exe","C:\\Program Files\\Google\\Chrome\\chrome.exe"\r\n"GTA5.exe","4242","Console","1","1 200 Ko"\r\nligne cassée\r\n"Sans extension","C:\\x"');
    expect(procs).toEqual([{ name: "chrome.exe", path: "C:\\Program Files\\Google\\Chrome\\chrome.exe" }, { name: "GTA5.exe" }]);
  });
});

describe("surveillance", () => {
  it("signale les changements, garde le jeu principal tant qu'il tourne, et se vide à la fermeture", () => {
    const vus: string[][] = [];
    const principaux: Array<string | undefined> = [];
    const d = new JeuxDetecteur({ onChange: (r, principal) => (vus.push(r.map((j) => j.nom)), principaux.push(principal?.nom)) });
    d.ingerer([p("explorer.exe")]);
    expect(vus).toEqual([]);
    d.ingerer([p("GTA5.exe")]);
    d.ingerer([p("GTA5.exe")]);
    d.ingerer([p("GTA5.exe"), p("cs2.exe")]);
    d.ingerer([p("cs2.exe")]);
    d.ingerer([]);
    expect(vus).toEqual([["GTA V"], ["GTA V", "Counter-Strike 2"], ["Counter-Strike 2"], []]);
    expect(principaux).toEqual(["GTA V", "GTA V", "Counter-Strike 2", undefined]);
    expect(d.active).toBe(false);
  });

  it("garde l'API de l'ancien détecteur (active, games) et compte JEUX_PROCESSUS comme des jeux", () => {
    const d = new JeuxDetecteur({ supplementaires: ["MonSimu.exe"], onChange: () => undefined });
    d.ingerer([p("monsimu.exe")]);
    expect(d.active).toBe(true);
    expect(d.games).toEqual(["MonSimu"]);
  });

  it("préfère un jeu du catalogue à un jeu repéré par son dossier", () => {
    const d = new JeuxDetecteur({ onChange: () => undefined });
    d.ingerer([p("x.exe", "D:\\steamapps\\common\\Truc\\x.exe"), p("FC25.exe")]);
    expect(d.current?.nom).toBe("EA Sports FC");
  });

  it("fonctionne avec une liste fournie (test en direct)", async () => {
    const quand: string[] = [];
    const d = new JeuxDetecteur({ list: async () => '"FlightSimulator.exe","C:\\x"', intervalMs: 5, onChange: (r) => quand.push(r[0]!.nom) });
    d.start();
    await new Promise((r) => setTimeout(r, 40));
    d.stop();
    expect(quand).toEqual(["Microsoft Flight Simulator"]);
  });
});

describe("sessions et notes", () => {
  const nouveau = (t = { v: new Date("2026-11-23T20:00:00Z") }) => ({ t, s: new CompagnonStore(mkdtempSync(path.join(os.tmpdir(), "compagnon-")), () => t.v) });

  it("compte le temps de jeu et ne démarre pas deux fois la même session", () => {
    const { t, s } = nouveau();
    s.debut("GTA V", "monde-ouvert");
    s.debut("GTA V", "monde-ouvert");
    t.v = new Date("2026-11-23T21:30:00Z");
    expect(s.minutes("GTA V")).toBe(90);
    expect(s.fin("GTA V")?.minutes).toBe(90);
    expect(s.sessions()).toHaveLength(1);
    expect(s.minutes("GTA V")).toBe(90);
    expect(s.fin("GTA V")).toBeUndefined();
  });

  it("clôt les sessions restées ouvertes après un arrêt brutal", () => {
    const { s } = nouveau();
    s.debut("Elden Ring", "monde-ouvert");
    s.clorePerimees();
    expect(s.sessions()[0]).toMatchObject({ minutes: 0 });
    expect(s.sessions()[0]!.fin).toBeDefined();
  });

  it("garde les notes par jeu, les supprime, et refuse une note vide", () => {
    const { s } = nouveau();
    const n = s.ajouteNote("Elden Ring", "  Bloqué contre Margit  ");
    s.ajouteNote("GTA V", "Mission du braquage");
    expect(s.notes("Elden Ring").map((x) => x.texte)).toEqual(["Bloqué contre Margit"]);
    expect(() => s.ajouteNote("GTA V", "   ")).toThrow(/Écris/);
    expect(s.supprimeNote(n.id)).toBe(true);
    expect(s.notes("Elden Ring")).toEqual([]);
  });

  it("résume les jeux récents, du plus récent au plus ancien", () => {
    const { t, s } = nouveau();
    s.debut("A", "tir");
    t.v = new Date("2026-11-23T20:10:00Z");
    s.fin("A");
    t.v = new Date("2026-11-24T20:00:00Z");
    s.debut("B", "sport");
    t.v = new Date("2026-11-24T20:30:00Z");
    s.fin("B");
    expect(s.recents().map((r) => [r.jeu, r.minutes])).toEqual([["B", 30], ["A", 10]]);
  });
});

describe("coach et phrases", () => {
  it("interdit les spoilers par défaut et demande une capture seulement si on le veut", () => {
    const base = { jeu: "Elden Ring", genre: "monde-ouvert" as const, question: "Comment battre Margit ?", notes: [], proprietaire: "Alex" };
    const a = promptCoach({ ...base, sansSpoiler: true, ecran: false });
    expect(a).toContain("aucun spoiler");
    expect(a).not.toContain("ecran_capture");
    expect(a).toContain("Comment battre Margit ?");
    const b = promptCoach({ ...base, sansSpoiler: false, ecran: true });
    expect(b).toContain("ecran_capture");
    expect(b).toContain("accepte les spoilers");
  });

  it("injecte les notes de progression", () => {
    const prompt = promptCoach({ jeu: "GTA V", genre: "monde-ouvert", question: "?", notes: [{ id: "1", jeu: "GTA V", texte: "Mission du casino", date: "" }], sansSpoiler: true, ecran: false, proprietaire: "Alex" });
    expect(prompt).toContain("Mission du casino");
  });

  it("formule le jeu en cours et le dernier jeu joué", () => {
    expect(phraseJeu({ nom: "GTA V", genre: "monde-ouvert", source: "catalogue", processus: "GTA5.exe" }, 75, [])).toBe("GTA V est en cours (monde ouvert), depuis 1 h 15 sur cette installation de Jarvis.");
    expect(phraseJeu(undefined, 0, [])).toMatch(/Aucun jeu détecté/);
    expect(phraseJeu(undefined, 0, [{ jeu: "FC25", minutes: 45 }])).toBe("Aucun jeu en cours. Dernier jeu : FC25 (45 min au total).");
    expect(dureeLisible(0)).toBe("moins d'une minute");
  });
});
