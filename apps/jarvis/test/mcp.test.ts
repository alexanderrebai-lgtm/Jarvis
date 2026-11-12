import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Inbox } from "../src/inbox.js";
import { createMcpServer } from "../src/mcp.js";
import { NotesRepository } from "../src/notes.js";
import { PendingActions } from "../src/pending.js";
import { createWebhookServer, mcpAuthorized } from "../src/server.js";

const SECRET = "secret-de-test-123";
let server: Server;
let base: string;
let inbox: Inbox;

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jarvis-mcp-"));
  inbox = new Inbox(dir);
  const ctx = { mail: undefined, agenda: undefined, notes: new NotesRepository(dir), pending: new PendingActions(dir), inbox, browser: undefined };
  server = createWebhookServer(SECRET, {
    createMcp: () => createMcpServer(ctx, "Alex"),
    onIncoming: async (message) => {
      inbox.add(message);
      return { recu: true };
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server?.close());

async function connect(url: string) {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

describe("connecteur Claude (MCP)", () => {
  it("refuse sans le bon secret", async () => {
    expect(mcpAuthorized(`/mcp/${SECRET}`, undefined, SECRET)).toBe(true);
    expect(mcpAuthorized("/mcp/faux", undefined, SECRET)).toBe(false);
    expect(mcpAuthorized("/mcp", `Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(mcpAuthorized("/mcp", undefined, SECRET)).toBe(false);
    await expect(connect(`${base}/mcp/faux`)).rejects.toThrow();
  });

  it("expose les outils et lit les SMS transmis par l'iPhone", async () => {
    const res = await fetch(`${base}/message`, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ de: "Léa", contenu: "Tu passes ce soir ?" }),
    });
    expect(await res.json()).toEqual({ recu: true });

    const client = await connect(`${base}/mcp/${SECRET}`);
    expect(client.getInstructions()).toContain("Jarvis");
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["messages_recus", "note_ajouter", "decision_faisabilite", "action_executer"]));
    // Gmail, Agenda et navigateur non configurés : leurs outils ne sont pas proposés.
    expect(names.some((n) => n.startsWith("mail") || n.startsWith("agenda") || n.startsWith("navigateur"))).toBe(false);

    const result = await client.callTool({ name: "messages_recus", arguments: {} });
    expect(JSON.stringify(result.content)).toContain("Tu passes ce soir ?");

    const calc = await client.callTool({ name: "probabilite_au_moins_un", arguments: { probabilites: [0.5, 0.5] } });
    expect(JSON.stringify(calc.content)).toContain("0.75");

    const bad = await client.callTool({ name: "action_executer", arguments: { action: "act_inexistante" } });
    expect(JSON.stringify(bad.content)).toContain("déjà été traitée ou a expiré");
    await client.close();
  });
});
