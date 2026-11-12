import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Journal } from "../src/main/journal.js";
import { personaPrompt } from "../src/main/persona.js";

describe("journal de bord", () => {
  it("retrouve un échange passé, sans tenir compte des accents", () => {
    let now = new Date("2026-10-02T20:00:00Z");
    const journal = new Journal(mkdtempSync(path.join(tmpdir(), "jarvis-journal-")), () => now);
    journal.add({ demande: "Réglages de la Porsche à Spa", reponse: "Appui arrière +2, pression 26,5 psi", outils: ["Write", "Write"] });
    now = new Date("2026-11-10T09:00:00Z");
    journal.add({ demande: "Planning de l'équipe", reponse: "Planning envoyé", outils: [] });
    expect(journal.search("reglages spa", 60)).toEqual([
      { date: "2026-10-02T20:00:00.000Z", demande: "Réglages de la Porsche à Spa", reponse: "Appui arrière +2, pression 26,5 psi", outils: ["Write"] },
    ]);
    expect(journal.search("spa", 7)).toEqual([]);
    expect(journal.search(undefined, 7).map((e) => e.demande)).toEqual(["Planning de l'équipe"]);
  });
});

describe("personnalité", () => {
  it("intègre ce que Jarvis a appris d'Alex", () => {
    const prompt = personaPrompt({
      ownerName: "Alex",
      workspace: "C:\\Jarvis",
      os: "Windows",
      memories: [
        { id: "m1", fait: "Consigne : toujours donner les temps au tour en secondes avec trois décimales.", creeLe: "" },
        { id: "m2", fait: "Il roule sur iRacing avec un volant Fanatec.", creeLe: "" },
      ],
    });
    expect(prompt).toContain("Consignes que tu as apprises");
    expect(prompt).toContain("trois décimales");
    expect(prompt).toContain("Fanatec");
  });
});
