import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

const MAX_BODY = 64 * 1024;

export const IncomingSchema = z.object({
  app: z.string().max(60).optional(),
  de: z.string().max(200),
  contenu: z.string().min(1).max(20000),
});

export const AskSchema = z.object({ texte: z.string().min(1).max(8000) });

export interface ServerHandlers {
  /** Un message reçu sur le téléphone (SMS, WhatsApp…), transmis par un raccourci iPhone. */
  onIncoming: (message: z.infer<typeof IncomingSchema>) => Promise<unknown>;
  /** Une question posée à la voix (« Dis Siri, Jarvis »). Absent sans clé API. */
  onAsk?: (text: string) => Promise<unknown>;
  /** Connecteur pour l'app Claude (MCP). */
  createMcp?: () => McpServer;
}

/** Le connecteur accepte le secret en en-tête, ou dans l'adresse (/mcp/<secret>) pour l'app Claude. */
export function mcpAuthorized(pathname: string, header: string | undefined, secret: string | undefined): boolean {
  if (!secret) return false;
  if (pathname === "/mcp") return isAuthorized(header, secret);
  const given = Buffer.from(pathname.slice("/mcp/".length));
  const expected = Buffer.from(secret);
  return pathname.startsWith("/mcp/") && given.length === expected.length && timingSafeEqual(given, expected);
}

async function handleMcp(req: IncomingMessage, res: ServerResponse, createMcp: () => McpServer): Promise<void> {
  // Mode sans état : un serveur neuf par requête, rien à nettoyer.
  const server = createMcp();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  const body = req.method === "POST" ? await readJson(req) : undefined;
  await transport.handleRequest(req, res, body);
}

export function isAuthorized(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("trop volumineux");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export function createWebhookServer(secret: string | undefined, handlers: ServerHandlers): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/sante") return send(res, 200, { ok: true });
      if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
        if (!handlers.createMcp) return send(res, 404, { erreur: "connecteur désactivé" });
        if (!mcpAuthorized(url.pathname, req.headers.authorization, secret)) return send(res, 401, { erreur: "non autorisé" });
        return await handleMcp(req, res, handlers.createMcp);
      }
      if (req.method !== "POST") return send(res, 404, { erreur: "introuvable" });
      if (!isAuthorized(req.headers.authorization, secret)) return send(res, 401, { erreur: "non autorisé" });

      if (url.pathname === "/message") {
        const parsed = IncomingSchema.safeParse(await readJson(req));
        if (!parsed.success) return send(res, 400, { erreur: "champs attendus : de, contenu, app (facultatif)" });
        return send(res, 200, await handlers.onIncoming(parsed.data));
      }
      if (url.pathname === "/demander") {
        if (!handlers.onAsk) return send(res, 404, { erreur: "nécessite une clé API Anthropic (mode automatique)" });
        const parsed = AskSchema.safeParse(await readJson(req));
        if (!parsed.success) return send(res, 400, { erreur: "champ attendu : texte" });
        return send(res, 200, await handlers.onAsk(parsed.data.texte));
      }
      return send(res, 404, { erreur: "introuvable" });
    } catch (error) {
      console.error("[serveur]", error);
      if (!res.headersSent) send(res, 500, { erreur: "erreur interne" });
    }
  });
}
