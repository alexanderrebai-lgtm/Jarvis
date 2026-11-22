import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NotesRepository } from "@muscu/jarvis/src/notes.js";
import { describe, expect, it } from "vitest";
import { Brain, type QueryFn } from "../src/main/brain.js";
import { Proactive } from "../src/main/proactive.js";
import { UsageStore, jourLocal, phraseUsage } from "../src/main/usage.js";

const dir = () => mkdtempSync(path.join(tmpdir(), "jarvis-usage-"));

describe("compteur d'usage", () => {
  it("cumule par jour et par source, du plus coûteux au moins coûteux (à coût égal, le plus d'appels d'abord)", () => {
    let maintenant = new Date(2026, 10, 22, 10, 0);
    const store = new UsageStore(dir(), () => maintenant);
    store.record({ source: "surveillance d'écran", usd: 0.05, entree: 1000, sortie: 50 });
    store.record({ source: "surveillance d'écran", usd: 0.05, entree: 1000, sortie: 50 });
    store.record({ source: "conversation", usd: 0.3, entree: 5000, sortie: 400 });
    maintenant = new Date(2026, 10, 21, 10, 0);
    store.record({ source: "briefings", usd: 0.1 });
    maintenant = new Date(2026, 10, 22, 18, 0);
    const s = store.summary(30);
    expect(s.aujourdhui).toMatchObject({ appels: 3, usd: 0.4, entree: 7000, sortie: 500 });
    expect(s.mois.appels).toBe(4);
    expect(s.jours).toHaveLength(30);
    expect(s.jours[s.jours.length - 1]!.jour).toBe(jourLocal(maintenant));
    expect(s.parSource.map((x) => x.source)).toEqual(["conversation", "surveillance d'écran", "briefings"]);
  });

  it("calcule la part du plafond du jour", () => {
    const store = new UsageStore(dir(), () => new Date(2026, 10, 22, 10, 0));
    store.record({ source: "conversation", usd: 0.5 });
    expect(store.partDuPlafond(undefined)).toBeUndefined();
    expect(store.partDuPlafond(0)).toBeUndefined();
    expect(store.partDuPlafond(1)).toBeCloseTo(0.5);
    store.record({ source: "conversation", usd: 0.6 });
    expect(store.partDuPlafond(1)!).toBeGreaterThanOrEqual(1);
  });

  it("oublie ce qui a plus de trois mois", () => {
    let maintenant = new Date(2026, 5, 1, 10, 0);
    const store = new UsageStore(dir(), () => maintenant);
    store.record({ source: "vieux", usd: 1 });
    maintenant = new Date(2026, 10, 22, 10, 0);
    store.record({ source: "récent", usd: 1 });
    expect(store.summary(200).parSource.map((x) => x.source)).toEqual(["récent"]);
  });

  it("dit où ça part en une phrase", () => {
    const store = new UsageStore(dir(), () => new Date(2026, 10, 22, 10, 0));
    store.record({ source: "mails importants", usd: 0.2 });
    expect(phraseUsage(store.summary(30), 2)).toMatch(/1 appel.*0\.20 \$.*mails importants.*Plafond du jour : 2\.00 \$/);
  });
});

describe("le cerveau déclare son usage avec la source", () => {
  const fake = (): QueryFn => ((_p: unknown) => (async function* () {
    yield { type: "result", subtype: "success", result: "ok", total_cost_usd: 0.02, usage: { input_tokens: 1200, output_tokens: 80 } };
  })()) as unknown as QueryFn;

  it("distingue conversation, demande automatique étiquetée et tâche de fond", async () => {
    const vus: Array<{ source: string; usd?: number | undefined; entree?: number | undefined; sortie?: number | undefined }> = [];
    const b = new Brain({ dataDir: dir(), workspace: "C:\\Jarvis", systemPrompt: "p", mcpServers: {}, queryFn: fake(), onUsage: (u) => vus.push(u) });
    await b.ask("Salut");
    await b.ask("regarde", {}, { trust: "restreint", outils: [], source: "surveillance d'écran" });
    await b.ask("autre chose", {}, { separate: true });
    expect(vus.map((u) => u.source)).toEqual(["conversation", "surveillance d'écran", "autre"]);
    expect(vus[0]).toMatchObject({ usd: 0.02, entree: 1200, sortie: 80 });
  });
});

describe("plafond atteint : le proactif automatique attend demain", () => {
  it("ne lance ni briefing ni analyse de mails quand c'est interdit, mais reprend ensuite", async () => {
    const now = new Date("2026-11-12T06:45:00Z");
    const d = dir();
    let autorise = false;
    const asked: string[] = [];
    const p = new Proactive({
      dataDir: d, timeZone: "Europe/Paris", ownerName: "Alex", briefing: { hour: 7, minute: 30 }, eventReminderMinutes: 15,
      notes: new NotesRepository(d, () => now), agenda: undefined, mail: undefined,
      brain: { ask: async (prompt: string) => (asked.push(prompt), { text: "Bonjour." }) },
      say: () => undefined, notify: () => undefined, canSpeak: () => true, autoAllowed: () => autorise, now: () => now,
    });
    await p.morning();
    expect(asked).toHaveLength(0);
    autorise = true;
    await p.morning();
    expect(asked).toHaveLength(1);
  });
});
