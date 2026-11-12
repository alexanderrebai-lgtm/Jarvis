import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Brain, type QueryFn } from "../src/main/brain.js";
import { ScreenMap } from "../src/main/desktop-tools.js";

type Call = { prompt: string; options: Record<string, any> };

function fakeQuery(script: (call: Call) => unknown[]): { fn: QueryFn; calls: Call[] } {
  const calls: Call[] = [];
  const fn = ((params: Call) => {
    calls.push(params);
    const messages = script(params);
    return (async function* () {
      for (const m of messages) {
        if (m instanceof Error) throw m;
        yield m;
      }
    })();
  }) as unknown as QueryFn;
  return { fn, calls };
}

const delta = (text: string) => ({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text } } });

function brain(queryFn: QueryFn) {
  return new Brain({ dataDir: mkdtempSync(path.join(tmpdir(), "jarvis-brain-")), workspace: "C:\\Users\\Alex\\Documents\\Jarvis", systemPrompt: "persona", mcpServers: {}, queryFn });
}

describe("cerveau", () => {
  it("diffuse la réponse au fil de l'eau et reprend la même conversation", async () => {
    const { fn, calls } = fakeQuery(() => [
      { type: "system", subtype: "init", session_id: "sess-1" },
      delta("Bonjour "),
      delta("Alex."),
      { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", name: "mcp__jarvis__tapo_commande", input: {} }] } },
      { type: "result", subtype: "success", result: "Bonjour Alex.", total_cost_usd: 0.01 },
    ]);
    const b = brain(fn);
    const deltas: string[] = [];
    const tools: string[] = [];
    const reply = await b.ask("Salut", { onText: (d) => deltas.push(d), onTool: (n) => tools.push(n) });
    expect(reply).toEqual({ text: "Bonjour Alex.", costUsd: 0.01 });
    expect(deltas.join("")).toBe("Bonjour Alex.");
    expect(tools).toEqual(["mcp__jarvis__tapo_commande"]);
    await b.ask("Et ensuite ?");
    expect(calls[0]!.options.resume).toBeUndefined();
    expect(calls[1]!.options.resume).toBe("sess-1");
    expect(calls[0]!.options.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: "persona" });
  });

  it("applique les limites dures avant chaque outil", async () => {
    const { fn, calls } = fakeQuery(() => [{ type: "result", subtype: "success", result: "ok" }]);
    await brain(fn).ask("test");
    const canUseTool = calls[0]!.options.canUseTool;
    expect(await canUseTool("PowerShell", { command: "format D: /q" })).toMatchObject({ behavior: "deny" });
    expect(await canUseTool("mcp__jarvis__pc_ouvrir", { cible: "excel" })).toMatchObject({ behavior: "allow" });
  });

  it("explique simplement un problème de connexion à Claude", async () => {
    const { fn } = fakeQuery(() => [new Error("Invalid API key · Please run /login (not logged in)")]);
    const reply = await brain(fn).ask("Salut");
    expect(reply.text).toMatch(/lance « claude »/);
  });

  it("une demande séparée (tri des mails) ne touche pas la conversation principale", async () => {
    const { fn, calls } = fakeQuery((call) => [
      { type: "system", subtype: "init", session_id: call.prompt === "principal" ? "main" : "autre" },
      { type: "result", subtype: "success", result: "RIEN" },
    ]);
    const b = brain(fn);
    await b.ask("principal");
    await b.ask("tri", {}, { separate: true });
    await b.ask("suite");
    expect(calls[1]!.options.resume).toBeUndefined();
    expect(calls[2]!.options.resume).toBe("main");
  });
});

describe("clics à l'écran", () => {
  it("convertit un point de la capture en pixel réel (écran 4K réduit, second écran)", () => {
    const map = new ScreenMap();
    map.remember([
      { nom: "Principal", jpegBase64: "", width: 1568, height: 882, originX: 0, originY: 0, scale: 3840 / 1568 },
      { nom: "Second", jpegBase64: "", width: 1568, height: 882, originX: 3840, originY: 0, scale: 1920 / 1568 },
    ]);
    expect(map.toPhysical(784, 441)).toEqual({ x: 1920, y: 1080 });
    expect(map.toPhysical(0, 0, 1)).toEqual({ x: 3840, y: 0 });
    expect(() => map.toPhysical(2000, 10)).toThrow(/hors de l'image/);
    expect(() => new ScreenMap().toPhysical(1, 1)).toThrow(/capture d'écran/);
  });
});

describe("messages d'erreur en français", () => {
  it("traduit les erreurs techniques et trouve le moteur Claude", async () => {
    const { explain, findClaudeExecutable } = await import("../src/main/brain.js");
    expect(explain("Native CLI binary for win32-x64 not found. Reinstall @anthropic-ai/claude-agent-sdk")).toContain("moteur Claude est introuvable");
    expect(explain("Error: 429 rate_limit_error")).toContain("limite");
    expect(explain("something weird happened")).not.toMatch(/something/);
    const found = findClaudeExecutable({ CLAUDE_CODE_CHEMIN: "" }, (p) => p.includes(`${path.sep}claude${path.sep}claude`), "/res");
    expect(found).toBe(path.join("/res", "claude", process.platform === "win32" ? "claude.exe" : "claude"));
  });
});
