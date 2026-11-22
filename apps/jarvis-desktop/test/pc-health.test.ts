import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePageCommand } from "../src/main/pages/catalog.js";
import { analyzeHealth, GameRecorder, healthReport, healthSummaryForWeb, parseCollect, parseNvidia, type HealthRaw } from "../src/main/pc-health.js";

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

const base = (): HealthRaw => ({
  arretsBrutaux: [],
  arretsInattendus: [],
  erreursMaterielles: [],
  plantagesPilote: [],
  minidumps: [],
  memoire: [{ capaciteGo: 8, vitesse: 3200, configuree: 3200 }, { capaciteGo: 8, vitesse: 3200, configuree: 3200 }],
  disques: [{ nom: "Samsung 970", sante: "Healthy", type: "SSD", tailleGo: 1000 }],
  programmesDemarrage: [],
  relevesJeu: [],
  planAlimentation: { guid: "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c", nom: "Performances élevées" },
});

describe("lecture des informations de Windows", () => {
  it("lit la sortie du script PowerShell, même avec des champs uniques ou absents", () => {
    const raw = parseCollect(JSON.stringify({
      windows: "Microsoft Windows 11 Famille 10.0.26100",
      arretsBrutaux: { date: "2026-11-21T21:43:00Z", bugcheck: 0 },
      arretsInattendus: null,
      plan: "GUID du mode de gestion de l'alimentation : 381b4222-f694-41f0-9685-ff5bb260df2e  (Utilisation normale)",
      modeJeuWindows: 0,
      hags: 2,
      memoire: [{ capaciteGo: 8, vitesse: 3600, configuree: 2400 }],
      disques: [],
      libreSystemePct: 42,
      programmesDemarrage: "Discord",
    }));
    expect(raw.arretsBrutaux).toEqual([{ date: "2026-11-21T21:43:00Z", bugcheck: 0 }]);
    expect(raw.arretsInattendus).toEqual([]);
    expect(raw.planAlimentation).toEqual({ guid: "381b4222-f694-41f0-9685-ff5bb260df2e", nom: "Utilisation normale" });
    expect(raw.modeJeuWindows).toBe(false);
    expect(raw.hags).toBe(true);
    expect(raw.programmesDemarrage).toEqual(["Discord"]);
  });

  it("lit nvidia-smi", () => {
    expect(parseNvidia("NVIDIA GeForce RTX 3070, 566.36, 71, 198.52, 220.00, 220.00, 240.00, 54, 6120, 8192\n", "0x0000000000000004")).toEqual({
      nom: "NVIDIA GeForce RTX 3070", pilote: "566.36", tempC: 71, puissanceW: 198.52, limiteW: 220, limiteDefautW: 220, limiteMaxW: 240, ventilateurPct: 54, memoireUtiliseeMo: 6120, memoireTotaleMo: 8192, bridage: "0x0000000000000004",
    });
    expect(parseNvidia("NVIDIA GeForce RTX 3070, 566.36, 65, [N/A], 220, 220, 240, [N/A], 100, 8192")?.puissanceW).toBeUndefined();
  });
});

describe("analyse", () => {
  it("arrêt brutal sans écran bleu : coupure de courant, alimentation en cause probable, test de limite proposé", () => {
    const raw = { ...base(), arretsBrutaux: [{ date: iso(60), bugcheck: 0 }], relevesJeu: [{ instant: iso(61), tempC: 74, puissanceW: 216, limiteW: 220 }] };
    const [first] = analyzeHealth(raw, { alimentation: "Advance 500 W" });
    expect(first!.gravite).toBe("critique");
    expect(first!.detail).toContain("74 °C, 216 W sur 220 W");
    expect(first!.conseil).toContain("alimentation");
    expect(first!.conseil).toContain("Advance 500 W");
    expect(first!.conseil).toContain("puissance maximale");
    expect(first!.actions?.[0]?.id).toBe("limite-gpu");
  });

  it("arrêt brutal avec une carte très chaude : la chaleur passe en premier", () => {
    const raw = { ...base(), arretsBrutaux: [{ date: iso(10), bugcheck: 0 }], relevesJeu: [{ instant: iso(11), tempC: 88, puissanceW: 200, limiteW: 220 }] };
    expect(analyzeHealth(raw)[0]!.conseil).toMatch(/poussière/);
  });

  it("écran bleu, erreurs matérielles, mémoire lente, plan d'alimentation", () => {
    const raw: HealthRaw = {
      ...base(),
      arretsBrutaux: [{ date: iso(30), bugcheck: 0x124 }],
      erreursMaterielles: [{ date: iso(31), message: "Une erreur matérielle corrigée s'est produite." }],
      memoire: [{ capaciteGo: 16, vitesse: 3600, configuree: 2666 }],
      planAlimentation: { guid: "381b4222-f694-41f0-9685-ff5bb260df2e", nom: "Utilisation normale" },
    };
    const ids = analyzeHealth(raw).map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["ecrans-bleus", "whea", "xmp", "plan", "ram"]));
    expect(analyzeHealth(raw).find((f) => f.id === "ecrans-bleus")!.detail).toContain("0x124");
  });

  it("PC sain", () => {
    expect(analyzeHealth(base())[0]!.id).toBe("ok");
  });

  it("rapport et résumé pour le web sans données personnelles", () => {
    const raw = { ...base(), arretsBrutaux: [{ date: iso(60), bugcheck: 0 }] };
    const findings = analyzeHealth(raw);
    expect(healthReport(raw, findings, { machine: "RTX 3070" })).toContain("coupure brutale");
    const web = healthSummaryForWeb(raw, findings, "Ryzen 7 5700G, RTX 3070", "Corsair RM750x");
    expect(web).toContain("Corsair RM750x");
    expect(web).not.toMatch(/Users|alexa|@/);
  });
});

describe("relevés pendant les parties", () => {
  it("écrit chaque relevé sur le disque et les relit", () => {
    const rec = new GameRecorder(mkdtempSync(path.join(tmpdir(), "rapports-")));
    rec.write({ nom: "RTX 3070", pilote: "1", tempC: 70, puissanceW: 190, limiteW: 220, ventilateurPct: 50 }, new Date(now - 60_000));
    rec.write({ nom: "RTX 3070", pilote: "1", tempC: 72, puissanceW: 205, limiteW: 220 }, new Date(now));
    const samples = rec.recent();
    expect(samples).toHaveLength(2);
    expect(samples[1]).toMatchObject({ tempC: 72, puissanceW: 205, limiteW: 220 });
  });
});

describe("à la voix", () => {
  it("« diagnostic du PC » ouvre la santé du PC, « diagnostic » reste le bilan de Jarvis", () => {
    expect(parsePageCommand("ouvre le diagnostic du PC")).toMatchObject({ action: "ouvrir", pages: ["sante"] });
    expect(parsePageCommand("ouvre le diagnostic")).toMatchObject({ action: "ouvrir", pages: ["diagnostic"] });
    expect(parsePageCommand("affiche les performances du PC")).toMatchObject({ action: "ouvrir", pages: ["performances"] });
  });
});
