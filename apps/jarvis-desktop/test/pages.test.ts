import { describe, expect, it } from "vitest";
import { nameDisplays, parsePageCommand } from "../src/main/pages/catalog.js";

describe("commandes de pages", () => {
  it("ouvre, ferme et déplace les pages", () => {
    expect(parsePageCommand("Ouvre l'ingénieur")).toEqual({ action: "ouvrir", pages: ["ingenieur"] });
    expect(parsePageCommand("Affiche la sécurité sur l'écran de droite.")).toEqual({ action: "ouvrir", pages: ["securite"], ecran: "droite" });
    expect(parsePageCommand("montre-moi les performances du PC")).toEqual({ action: "ouvrir", pages: ["performances"] });
    expect(parsePageCommand("Ferme la page travail")).toEqual({ action: "fermer", pages: ["travail"] });
    expect(parsePageCommand("ferme tout")).toEqual({ action: "fermer", pages: "toutes" });
    expect(parsePageCommand("Mets la R&D à gauche")).toEqual({ action: "deplacer", pages: ["rd"], ecran: "gauche" });
    expect(parsePageCommand("passe en mode course")).toEqual({ action: "ouvrir", pages: ["ingenieur"] });
  });

  it("laisse passer vers Claude ce qui n'est pas une commande de page", () => {
    expect(parsePageCommand("Ouvre Excel")).toBeUndefined();
    expect(parsePageCommand("Affiche-moi le planning de l'équipe pour décembre avec les absences de chacun et les heures sup")).toBeUndefined();
    expect(parsePageCommand("Quelle est la météo ?")).toBeUndefined();
    expect(parsePageCommand("mets la lumière du salon à 30 %")).toBeUndefined();
  });
});

describe("écrans", () => {
  const d = (id: number, x: number, primary = false) => ({ id, primary, bounds: { x, y: 0, width: 1920, height: 1080 } });

  it("nomme trois écrans de gauche à droite, le principal au centre", () => {
    const named = nameDisplays([d(2, 1920, true), d(1, 0), d(3, 3840)]);
    expect([named.gauche.id, named.centre.id, named.droite.id, named.principal.id]).toEqual([1, 2, 3, 2]);
  });

  it("s'adapte à un ou deux écrans", () => {
    expect(nameDisplays([d(1, 0, true)]).droite.id).toBe(1);
    const two = nameDisplays([d(1, 0, true), d(2, 1920)]);
    expect([two.gauche.id, two.droite.id, two.centre.id]).toEqual([1, 2, 1]);
  });
});
