import { createServer, type Server } from "node:http";

/**
 * Satellites vocaux : un micro dans une autre pièce (module ESP32, Home Assistant
 * Voice, téléphone…) envoie ce que tu as dit à Jarvis et lit sa réponse.
 * Jarvis ne fait ici que la partie « cerveau » : une petite porte HTTP protégée
 * par un jeton. Pas d'audio ici : le satellite fait la reconnaissance et la voix.
 *
 *   POST /demande   {"texte": "allume la lumière", "piece": "cuisine"}
 *   → {"reponse": "C'est fait."}
 *
 * Sécurité : sans jeton valide, rien ne passe. Et par défaut le satellite ne
 * peut que poser des questions : on ne vérifie pas la voix à distance, donc il
 * n'agit pas sur la maison, le PC ou les mails sauf si tu le décides.
 */

export interface SatelliteOptions {
  port: number;
  token: string;
  /** Pose la question au cerveau et rend la réponse à dire. */
  repondre: (texte: string, piece: string | undefined) => Promise<string>;
}

const MAX_BODY = 20_000;

export class SatelliteServer {
  private server: Server | undefined;
  private occupe = false;

  constructor(private readonly options: SatelliteOptions) {}

  start(): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      if (this.server) return resolve({ ok: true, message: "déjà démarré" });
      if (!this.options.token) return resolve({ ok: false, message: "pas de jeton : le serveur satellite ne démarre pas sans protection" });
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://x");
        const donne = req.headers["x-jeton"] ?? req.headers["authorization"]?.toString().replace(/^Bearer\s+/i, "") ?? url.searchParams.get("jeton");
        if (donne !== this.options.token) return void res.writeHead(401).end("jeton invalide");
        if (req.method !== "POST") return void res.writeHead(200, { "content-type": "text/plain" }).end("Jarvis satellite : prêt (POST JSON sur /demande).");
        let corps = "";
        let tropGros = false;
        req.on("data", (c) => {
          corps += c;
          if (corps.length > MAX_BODY) {
            tropGros = true;
            req.destroy();
          }
        });
        req.on("end", () => {
          if (tropGros) return;
          void this.traiter(corps, res);
        });
      });
      server.on("error", (error) => resolve({ ok: false, message: error instanceof Error ? error.message : String(error) }));
      server.listen(this.options.port, "0.0.0.0", () => {
        this.server = server;
        resolve({ ok: true, message: `à l'écoute sur le port ${this.options.port}` });
      });
    });
  }

  private async traiter(corps: string, res: import("node:http").ServerResponse): Promise<void> {
    let donnees: Record<string, unknown>;
    try {
      donnees = JSON.parse(corps || "{}") as Record<string, unknown>;
    } catch {
      return void res.writeHead(400).end("JSON invalide");
    }
    const texte = String(donnees.texte ?? donnees.text ?? donnees.prompt ?? "").trim().slice(0, 2000);
    const piece = String(donnees.piece ?? donnees.room ?? donnees.area ?? "").trim().slice(0, 60) || undefined;
    if (!texte) return void res.writeHead(400).end("texte manquant");
    if (this.occupe) return void res.writeHead(429, { "content-type": "application/json" }).end(JSON.stringify({ reponse: "Une seconde, je finis une autre demande." }));
    this.occupe = true;
    try {
      const reponse = await Promise.race([this.options.repondre(texte, piece), new Promise<string>((_, no) => setTimeout(() => no(new Error("délai dépassé")), 90_000))]);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify({ reponse }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify({ reponse: "Je n'ai pas pu répondre.", erreur: error instanceof Error ? error.message : String(error) }));
    } finally {
      this.occupe = false;
    }
  }

  stop(): void {
    this.server?.close();
    this.server = undefined;
  }
}
