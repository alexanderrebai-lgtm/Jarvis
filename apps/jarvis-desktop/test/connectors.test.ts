import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NotesRepository } from "@muscu/jarvis/src/notes.js";
import { connectorName, ConnectorStore, parseSecrets, splitCommand, testConnector } from "../src/main/connectors.js";
import type { Vault } from "../src/main/vault.js";

/** Coffre-fort en mémoire pour les tests. */
function memoryVault(): Vault {
  const data: Record<string, string> = {};
  return {
    available: true,
    get: (k: string) => data[k],
    set: (k: string, v: string | undefined) => (v === undefined ? delete data[k] : (data[k] = v)),
    getJson: (k: string) => (data[k] ? JSON.parse(data[k]!) : undefined),
    setJson: (k: string, v: unknown) => (v === undefined ? delete data[k] : (data[k] = JSON.stringify(v))),
    keys: () => Object.keys(data),
  } as unknown as Vault;
}

describe("connecteurs MCP", () => {
  it("découpe les commandes, lit les secrets, nettoie les noms", () => {
    expect(splitCommand('npx -y @modelcontextprotocol/server-filesystem "C:\\Mes Documents"')).toEqual(["npx", "-y", "@modelcontextprotocol/server-filesystem", "C:\\Mes Documents"]);
    expect(parseSecrets("Authorization=Bearer abc=\n# commentaire\nTOKEN = x")).toEqual({ Authorization: "Bearer abc=", TOKEN: "x" });
    expect(connectorName("Home Assistant !")).toBe("home-assistant");
    expect(() => connectorName("jarvis")).toThrow(/réservé/);
  });

  it("garde les jetons au coffre-fort, jamais dans le fichier, et ne les efface pas si on ne les retape pas", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mcp-"));
    const vault = memoryVault();
    const store = new ConnectorStore(dir, vault);
    store.save({ nom: "Home Assistant", type: "web", url: "http://ha.local:8123/api/mcp", secrets: "Authorization=Bearer secret-123" });
    expect(JSON.stringify(store.list())).not.toContain("secret-123");
    expect(store.list()[0]).toMatchObject({ nom: "home-assistant", actif: true, secrets: ["Authorization"] });
    store.save({ nom: "home-assistant", type: "web", url: "http://ha.local:8123/api/mcp", secrets: "Authorization=Bearer " });
    expect(store.active()["home-assistant"]).toEqual({ type: "http", url: "http://ha.local:8123/api/mcp", headers: { Authorization: "Bearer secret-123" } });
    store.setActive("home-assistant", false);
    expect(store.active()).toEqual({});
    expect(() => store.save({ nom: "x", type: "web", url: "ftp://nope" })).toThrow(/http/);
    store.remove("home-assistant");
    expect(store.list()).toEqual([]);
    expect(vault.keys()).toEqual([]);
  });

  it("se connecte à un vrai serveur MCP et liste ses outils", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mcp-srv-"));
    const server = path.join(dir, "serveur.mjs");
    // Racine du paquet (le package.json résolu peut être celui de dist/cjs).
    let sdk = path.dirname(require.resolve("@modelcontextprotocol/sdk/package.json"));
    while (!existsSync(path.join(sdk, "dist", "esm"))) sdk = path.dirname(sdk);
    writeFileSync(
      server,
      `import { McpServer } from ${JSON.stringify(path.join(sdk, "dist/esm/server/mcp.js"))};
import { StdioServerTransport } from ${JSON.stringify(path.join(sdk, "dist/esm/server/stdio.js"))};
const s = new McpServer({ name: "demo", version: "1.0.0" });
s.tool("bonjour", "Dit bonjour", async () => ({ content: [{ type: "text", text: "Bonjour" }] }));
await s.connect(new StdioServerTransport());`,
    );
    const ok = await testConnector({ type: "stdio", command: process.execPath, args: [server] });
    expect(ok).toMatchObject({ ok: true, outils: ["bonjour"] });
    const bad = await testConnector({ type: "stdio", command: "programme-qui-n-existe-pas", args: [] }, 10_000);
    expect(bad.ok).toBe(false);
  }, 60_000);
});

describe("mémoire", () => {
  it("corrige un souvenir", () => {
    const notes = new NotesRepository(mkdtempSync(path.join(tmpdir(), "mem-")));
    const m = notes.remember("Ma sœur s'appelle Lea");
    expect(notes.updateMemory(m.id, "Ma sœur s'appelle Léa")).toBe(true);
    expect(notes.memories()[0]!.fait).toBe("Ma sœur s'appelle Léa");
    expect(notes.updateMemory("inconnu", "x")).toBe(false);
  });
});
