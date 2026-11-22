import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeComponents, canClose, parseComponents, parseGpu } from "../src/main/pc-components.js";
import { elevated, parseState, PcTuning, stateScript, TWEAKS } from "../src/main/pc-tuning.js";

describe("optimisations : lecture de l'état", () => {
  it("lit les réglages, les programmes au démarrage et le fichier d'échange", () => {
    const state = parseState(
      JSON.stringify({
        registre: { "HKCU\\Software\\Microsoft\\GameBar\\AutoGameModeEnabled": 1, "HKCU\\System\\GameConfigStore\\GameDVR_Enabled": 1, "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers\\HwSchMode": 2 },
        demarrage: { nom: "Discord", commande: "Update.exe", ruche: "HKCU", actif: true },
        fichierEchangeAuto: false,
      }),
      { "capture-arriere-plan": { avant: {}, date: "x" } },
    );
    const byId = Object.fromEntries(state.reglages.map((r) => [r.id, r]));
    expect(byId["mode-jeu-windows"]).toMatchObject({ actif: true, admin: false });
    expect(byId["capture-arriere-plan"]).toMatchObject({ actif: false, annulable: true });
    expect(byId["planification-gpu"]).toMatchObject({ actif: true, admin: true, redemarrage: true });
    expect(byId["point-restauration"]).toMatchObject({ ponctuel: true, actif: null });
    expect(state.demarrage).toEqual([{ nom: "Discord", commande: "Update.exe", ruche: "HKCU", actif: true }]);
    expect(state.fichierEchangeAuto).toBe(false);
    expect(stateScript()).toContain("StartupApproved");
  });

  it("chaque réglage du registre a un id unique et des valeurs", () => {
    expect(new Set(TWEAKS.map((t) => t.id)).size).toBe(TWEAKS.length);
    for (const t of TWEAKS) if (t.kind === "registre") expect(t.valeurs.length).toBeGreaterThan(0);
  });
});

describe("optimisations : appliquer et annuler", () => {
  const fakeRunner = () => {
    const scripts: string[] = [];
    const run = async (script: string) => {
      scripts.push(script);
      // Lecture des valeurs actuelles avant un changement : AutoGameModeEnabled valait 0.
      if (script.includes("ConvertTo-Json") && !script.includes("StartupApproved")) return { code: 0, stdout: '{"HKCU\\\\Software\\\\Microsoft\\\\GameBar\\\\AutoGameModeEnabled":0}', stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    return { scripts, run };
  };

  it("garde l'ancienne valeur et la remet à l'annulation", async () => {
    const { scripts, run } = fakeRunner();
    const t = new PcTuning(mkdtempSync(path.join(tmpdir(), "tuning-")), run);
    const applied = await t.apply("mode-jeu-windows");
    expect(applied.ok).toBe(true);
    expect(scripts.at(-1)).toContain("-Value 1 -Type DWord");
    expect(t.store.read()["mode-jeu-windows"]!.avant).toEqual({ "HKCU\\Software\\Microsoft\\GameBar\\AutoGameModeEnabled": 0 });
    const undone = await t.apply("mode-jeu-windows", true);
    expect(undone.message).toContain("remis comme avant");
    expect(scripts.at(-1)).toContain("-Value 0 -Type DWord");
    expect(t.store.read()["mode-jeu-windows"]).toBeUndefined();
    expect((await t.apply("mode-jeu-windows", true)).ok).toBe(false);
  });

  it("les réglages système passent par l'autorisation de Windows", async () => {
    const { scripts, run } = fakeRunner();
    const t = new PcTuning(mkdtempSync(path.join(tmpdir(), "tuning-")), run);
    await t.apply("planification-gpu");
    expect(scripts.at(-1)).toContain("-Verb RunAs");
    expect((await t.apply("inconnu")).ok).toBe(false);
    expect(elevated("Write-Output 1")).toContain("-EncodedCommand");
  });

  it("désactive un programme au démarrage sans le supprimer", async () => {
    const { scripts, run } = fakeRunner();
    const t = new PcTuning(mkdtempSync(path.join(tmpdir(), "tuning-")), run);
    const r = await t.setStartup({ nom: "Discord", ruche: "HKCU" }, false);
    expect(r.message).toContain("ne se lancera plus");
    expect(scripts.at(-1)).toContain("[byte[]](3,0,0,0");
    expect(scripts.at(-1)).not.toMatch(/Remove-Item/);
  });
});

describe("diagnostic des composants", () => {
  const gpu = parseGpu("NVIDIA GeForce RTX 3070, 566.36, 86, 97, 60, 7600, 8192, 212.4, 220.0, 1905, 2100, 7000, 7001, 78, 4, 4, 8, 16, P2");

  it("lit nvidia-smi (fréquences, liaison PCIe)", () => {
    expect(gpu).toMatchObject({ tempC: 86, memoireUtiliseeMo: 7600, pcieLargeur: 8, pcieLargeurMax: 16, pstate: "P2" });
  });

  it("repère carte chaude, PCIe réduit, mémoire presque pleine, fichier d'échange trop petit, simple canal", () => {
    const raw = parseComponents(
      JSON.stringify({
        cpu: { nom: "AMD Ryzen 7 5700G", coeurs: 8, threads: 16, frequenceMaxMhz: 3801, chargePct: 35 },
        memoire: { totaleMo: 15800, libreMo: 1500, engageeMo: 21000, limiteEngagementMo: 22000, fichierEchangeMo: 2048, fichierEchangeAuto: false, modules: { capaciteGo: 16, vitesse: 3200, configuree: 2400 } },
        processus: [{ nom: "LeMansUltimate", id: 42, memoireMo: 7000 }],
        disques: [{ nom: "Samsung 980", type: "SSD", sante: "Healthy", tailleGo: 1000, temperatureC: 70, usurePct: 5 }],
        volumes: [{ lettre: "C", tailleGo: 1000, libreGo: 50 }],
        reseau: { nom: "Wi-Fi", description: "Intel Wi-Fi 6 AX200", vitesse: "1.2 Gbps", type: "Native 802.11" },
        systeme: { windows: "Windows 11 Famille", build: "26100", joursAllume: 12.5 },
      }),
      gpu,
    );
    const reports = analyzeComponents(raw);
    const by = Object.fromEntries(reports.map((r) => [r.id, r]));
    expect(by["carte-graphique"]!.etat).toBe("attention");
    expect(by["carte-graphique"]!.constats.join(" ")).toMatch(/x8 au lieu de x16/);
    expect(by["memoire"]!.etat).toBe("erreur");
    expect(by["memoire"]!.constats.join(" ")).toMatch(/Fichier d'échange réglé à la main/);
    expect(by["memoire"]!.constats.join(" ")).toMatch(/simple canal/);
    expect(by["memoire"]!.constats.join(" ")).toMatch(/XMP/);
    expect(by["disques"]!.constats.join(" ")).toMatch(/70 °C/);
    expect(by["disques"]!.constats.join(" ")).toMatch(/presque plein/);
    expect(by["reseau"]!.constats.join(" ")).toMatch(/Ethernet/);
    expect(by["systeme"]!.constats.join(" ")).toMatch(/12 jours/);
  });

  it("ne propose jamais de fermer Windows ou Jarvis", () => {
    expect(canClose("chrome")).toBe(true);
    expect(canClose("explorer")).toBe(false);
    expect(canClose("svchost")).toBe(false);
    expect(canClose("Jarvis")).toBe(false);
  });
});
