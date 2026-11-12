import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { Assistant } from "../src/agent.js";
import { Inbox } from "../src/inbox.js";
import { NotesRepository } from "../src/notes.js";
import { PendingActions } from "../src/pending.js";
import { runTool, toolDefinitions } from "../src/tools.js";

/** Faux client Claude : renvoie des réponses préparées et garde les requêtes reçues. */
function fakeClient(responses: Array<Partial<Anthropic.Beta.BetaMessage>>) {
  const requests: Array<Record<string, unknown>> = [];
  const client = {
    beta: {
      messages: {
        create: async (params: Record<string, unknown>) => {
          requests.push(structuredClone(params));
          const next = responses.shift();
          if (!next) throw new Error("plus de réponse préparée");
          return next;
        },
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

function setup(responses: Array<Partial<Anthropic.Beta.BetaMessage>>) {
  const dir = mkdtempSync(path.join(tmpdir(), "jarvis-agent-"));
  const notes = new NotesRepository(dir);
  const pending = new PendingActions(dir);
  const { client, requests } = fakeClient(responses);
  const assistant = new Assistant({
    model: "claude-opus-5-5",
    ownerName: "Alex",
    timeZone: "Europe/Paris",
    dataDir: dir,
    notes,
    client,
    tools: { mail: undefined, agenda: undefined, notes, pending, inbox: new Inbox(dir), browser: undefined },
  });
  return { assistant, notes, requests };
}

describe("Assistant", () => {
  it("exécute un outil puis répond, et garde l'historique", async () => {
    const { assistant, notes, requests } = setup([
      {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "t1", name: "note_ajouter", input: { texte: "Acheter du pain" } }],
      } as Partial<Anthropic.Beta.BetaMessage>,
      { stop_reason: "end_turn", content: [{ type: "text", text: "C'est noté !", citations: null }] } as Partial<Anthropic.Beta.BetaMessage>,
      { stop_reason: "end_turn", content: [{ type: "text", text: "Du pain.", citations: null }] } as Partial<Anthropic.Beta.BetaMessage>,
    ]);
    const first = await assistant.ask("chat", "Note : acheter du pain");
    expect(first.text).toBe("C'est noté !");
    expect(notes.list()[0]!.texte).toBe("Acheter du pain");

    assistant.notify("chat", "SMS reçu de Léa : « tu passes ce soir ? »");
    await assistant.ask("chat", "Qu'est-ce que j'ai noté ?");
    const last = requests.at(-1)!;
    const messages = last.messages as Anthropic.Beta.BetaMessageParam[];
    // Historique conservé tel quel (préfixe identique) et événement transmis.
    expect(messages).toHaveLength(5);
    expect(JSON.stringify(messages.slice(0, 3))).toBe(JSON.stringify((requests[1]!.messages as unknown[]).slice(0, 3)));
    expect(messages[4]!.content).toContain("SMS reçu de Léa");
    // Consigne identique d'une requête à l'autre (cache et raisonnement préservés).
    expect(new Set(requests.map((r) => r.system)).size).toBe(1);
    expect(last.fallbacks).toBe("default");
  });

  it("refuse un outil indisponible ou mal rempli sans planter", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jarvis-tools-"));
    const notes = new NotesRepository(dir);
    const pending = new PendingActions(dir);
    const created: never[] = [];
    const missing = await runTool("mail_preparer_envoi", { a: "x@y.z", objet: "o", corps: "c" }, { mail: undefined, agenda: undefined, notes, pending, inbox: new Inbox(dir), browser: undefined }, created);
    expect(missing.isError).toBe(true);
    expect(missing.content).toMatch(/Gmail n'est pas connecté/);
    const invalid = await runTool("decision_matrice", { criteres: "x" }, { mail: undefined, agenda: undefined, notes, pending, inbox: new Inbox(dir), browser: undefined }, created);
    expect(invalid.isError).toBe(true);
  });

  it("déclare des outils aux schémas valides et la recherche web", () => {
    const tools = toolDefinitions();
    const names = tools.map((t) => ("name" in t ? t.name : ""));
    expect(names).toContain("web_search");
    expect(new Set(names).size).toBe(names.length);
    for (const t of tools) {
      if ("input_schema" in t) expect(t.input_schema.type).toBe("object");
    }
  });
});
