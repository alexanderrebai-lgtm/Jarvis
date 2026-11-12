import { describe, expect, it } from "vitest";
import { analyseEsperance, auMoinsUn, faisabilite, matriceDecision, seededRandom } from "../src/decision.js";

describe("analyseEsperance", () => {
  it("calcule espérance, risque et probabilité de perte, et classe les options", () => {
    const [premier, second] = analyseEsperance([
      { nom: "Livret", scenarios: [{ description: "sûr", probabilite: 1, valeur: 30 }] },
      {
        nom: "Projet",
        scenarios: [
          { description: "succès", probabilite: 0.4, valeur: 200 },
          { description: "échec", probabilite: 0.6, valeur: -50 },
        ],
      },
    ]);
    expect(premier!.nom).toBe("Projet");
    expect(premier!.esperance).toBe(50);
    expect(premier!.probabilitePerte).toBe(0.6);
    expect(premier!.ecartType).toBeCloseTo(122.47, 1);
    expect(second!.ecartType).toBe(0);
  });

  it("ramène les probabilités à 1 et le signale", () => {
    const [option] = analyseEsperance([
      { nom: "A", scenarios: [{ description: "x", probabilite: 2, valeur: 10 }, { description: "y", probabilite: 2, valeur: 0 }] },
    ]);
    expect(option!.esperance).toBe(5);
    expect(option!.avertissements[0]).toMatch(/ramenées à 1/);
  });
});

describe("matriceDecision", () => {
  it("pondère les notes et signale les critères manquants", () => {
    const result = matriceDecision(
      [{ nom: "salaire", poids: 3 }, { nom: "trajet", poids: 1 }],
      [
        { nom: "Offre A", notes: { salaire: 8, trajet: 2 } },
        { nom: "Offre B", notes: { salaire: 6 } },
      ],
    );
    expect(result[0]).toMatchObject({ nom: "Offre A", score: 6.5 });
    expect(result[1]).toMatchObject({ nom: "Offre B", score: 4.5, criteresManquants: ["trajet"] });
  });
});

describe("faisabilite", () => {
  it("multiplie les étapes et désigne la plus fragile", () => {
    const result = faisabilite(
      [
        { nom: "financement", min: 0.5, max: 0.7 },
        { nom: "permis", min: 0.9, max: 0.9 },
      ],
      5000,
      seededRandom(42),
    );
    expect(result.probabiliteCentrale).toBeCloseTo(0.54, 4);
    expect(result.p10).toBeLessThan(result.p50);
    expect(result.p50).toBeLessThan(result.p90);
    expect(result.p50).toBeCloseTo(0.54, 1);
    expect(result.etapeCritique).toBe("financement");
  });

  it("gère une liste vide", () => {
    expect(faisabilite([]).probabiliteCentrale).toBe(0);
  });
});

describe("auMoinsUn", () => {
  it("8 candidatures à 15 % donnent environ 73 % d'avoir au moins une réponse", () => {
    expect(auMoinsUn(Array(8).fill(0.15))).toBeCloseTo(0.7275, 3);
  });
});
