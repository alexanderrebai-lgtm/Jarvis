import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Routines, runRoutine } from "../src/main/routines.js";
import { ConversationWindow, detectWake, wakeVariants } from "../src/shared/wake.js";
import { PAGES, parsePageCommand } from "../src/main/pages/catalog.js";

describe("mot d'éveil", () => {
  it("accepte d'autres noms réglés par Alex", () => {
    const names = wakeVariants("Vendredi, Jarvy");
    expect(detectWake("Vendredi, allume le salon", false, names)).toEqual({ awake: true, command: "allume le salon" });
    expect(detectWake("Vendredi, allume le salon", false)).toEqual({ awake: false, command: "" });
    expect(detectWake("Jarvis, quelle heure", false, names).command).toBe("quelle heure");
  });

  it("la durée d'écoute de la suite se règle à chaud (0 = toujours dire le nom)", () => {
    let seconds = 20;
    let now = 0;
    const w = new ConversationWindow(() => seconds * 1000, () => now);
    w.open();
    now = 10_000;
    expect(w.active).toBe(true);
    seconds = 0;
    w.open();
    expect(w.active).toBe(false);
  });
});

describe("mode absent", () => {
  it("met à jour l'ancienne routine « Je pars » non modifiée, sans toucher une routine personnalisée", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "routines-"));
    const old = [
      { id: "je-pars", nom: "Je pars", declencheurs: ["je pars", "je m'en vais"], etapes: [{ type: "lumieres", cible: "tout", action: "eteindre" }, { type: "surveillance", mode: "complete" }, { type: "dire", texte: "Bonne route. Je garde la maison." }] },
      { id: "je-rentre", nom: "Je suis rentré", declencheurs: ["je suis rentre"], etapes: [{ type: "dire", texte: "Perso" }] },
    ];
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "routines.json"), JSON.stringify(old));
    const routines = new Routines(dir);
    const pars = routines.get("je pars")!;
    expect(pars.etapes.some((e) => e.type === "attendre")).toBe(true);
    expect(pars.etapes.some((e) => e.type === "telephone")).toBe(true);
    expect(routines.match("mode absent")?.id).toBe("je-pars");
    expect(routines.get("je suis rentré")!.etapes).toEqual([{ type: "dire", texte: "Perso" }]);
  });

  it("dit l'annonce avant la pause, pas après", async () => {
    const said: string[] = [];
    const order: string[] = [];
    const result = await runRoutine(
      { id: "x", nom: "x", declencheurs: ["x"], etapes: [{ type: "dire", texte: "Je surveille dans une minute." }, { type: "attendre", secondes: 0.01 }, { type: "dire", texte: "Fin." }] },
      async (step) => {
        order.push(step.type);
        return step.type === "dire" ? step.texte : undefined;
      },
      (text) => said.push(text),
    );
    expect(said).toEqual(["Je surveille dans une minute."]);
    expect(result.faits).toEqual(["Fin."]);
  });
});

describe("page Journal", () => {
  it("s'ouvre à la voix", () => {
    expect(PAGES.some((p) => p.id === "journal")).toBe(true);
    expect(parsePageCommand("ouvre le journal")).toMatchObject({ action: "ouvrir", pages: ["journal"] });
  });
});
