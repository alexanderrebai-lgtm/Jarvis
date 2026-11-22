import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";

/**
 * Jarvis Mobile : une petite application web, servie par le PC, qu'on ajoute à
 * l'écran d'accueil du téléphone. Elle parle à Jarvis (discuter, voir l'état,
 * piloter la maison, la mémoire, le journal) avec les mêmes données que le PC.
 *
 * Sécurité (le téléphone ne doit jamais devenir une porte ouverte sur le PC) :
 *  - deux niveaux selon la route empruntée :
 *      « chiffre » : par Tailscale (réseau privé chiffré, appareils authentifiés) → contrôle complet ;
 *      « maison »  : par le Wi-Fi de la maison en HTTP clair → lecture limitée et questions seulement,
 *                    car quelqu'un sur le même Wi-Fi pourrait intercepter la connexion ;
 *  - un jeton long, échangé une seule fois contre un cookie HttpOnly (le jeton quitte l'adresse aussitôt) ;
 *  - liste blanche de canaux : les réglages (mots de passe, connecteurs qui lancent des programmes…) ne sont
 *    JAMAIS accessibles d'ici, même au niveau chiffré ;
 *  - anti force brute, vérification d'origine, seuls des fichiers nommés sont servis.
 */

export type Niveau = "chiffre" | "maison";

/** Lecture seule, permise partout (réseau de la maison compris) : rien de personnel. */
export const LECTURE_MAISON = ["capacites:lire", "cout:lire", "forme:lire", "jeu:etat"];
/** Lecture complète : seulement par le réseau chiffré. */
export const LECTURE_CHIFFRE = [...LECTURE_MAISON, "page:data", "journal:lire", "connecteurs:lister", "memoire:lire", "briefings:lister", "ameliorations:lire", "musique:etat"];
/** Actions : seulement par le réseau chiffré. Ni réglages, ni création de connecteurs, ni actions système du PC. */
export const ECRITURE_CHIFFRE = [
  "tapo:toggle", "securite:armer", "securite:mode", "reveil:passer", "musique:commande",
  "memoire:ajouter", "memoire:modifier", "memoire:oublier", "memoire:note-supprimer", "rappel:retour",
  "ameliorations:decider", "ameliorations:lancer", "briefings:ajouter", "briefings:basculer", "briefings:supprimer",
];

export function canalAutorise(canal: string, niveau: Niveau): "lecture" | "ecriture" | undefined {
  if (niveau === "chiffre") {
    if (ECRITURE_CHIFFRE.includes(canal)) return "ecriture";
    if (LECTURE_CHIFFRE.includes(canal)) return "lecture";
    return undefined;
  }
  return LECTURE_MAISON.includes(canal) ? "lecture" : undefined;
}

/** Valeur du cookie de session : dérivée du jeton, jamais le jeton lui-même. */
export function sessionCookie(token: string): string {
  return createHash("sha256").update(`jarvis-mobile|${token}`).digest("hex");
}

function egal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Fichiers servis (liste fermée : aucun chemin construit à partir de l'adresse demandée). */
const FICHIERS: Record<string, { fichier: string; type: string; public?: boolean }> = {
  "/": { fichier: "mobile.html", type: "text/html; charset=utf-8" },
  "/mobile.js": { fichier: "mobile.js", type: "text/javascript; charset=utf-8" },
  "/mobile.css": { fichier: "mobile.css", type: "text/css; charset=utf-8" },
  "/manifest.webmanifest": { fichier: "manifest.webmanifest", type: "application/manifest+json", public: true },
  "/icon-180.png": { fichier: "icon-180.png", type: "image/png", public: true },
  "/icon-512.png": { fichier: "icon-512.png", type: "image/png", public: true },
};

export interface MobileOptions {
  token: string;
  /** Une écoute par chemin d'accès : l'adresse (Tailscale ou maison), son port, son niveau de confiance. */
  ecoutes: Array<{ host: string; port: number; niveau: Niveau }>;
  /** Dossier des fichiers de l'application (dist/mobile). */
  dossier: string;
  /** Appelle un canal de Jarvis (déjà filtré par la liste blanche). */
  invoke: (canal: string, payload: unknown) => Promise<unknown>;
  /** Pose une question au cerveau ; « maison » = questions seulement. */
  demander: (texte: string, niveau: Niveau) => Promise<string>;
  version?: string;
  maintenant?: () => number;
}

const MAX_CORPS = 64_000;
const ESSAIS_MAX = 8;
const FENETRE_MS = 60_000;

const PAGE_REFUS = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jarvis</title><body style="font-family:system-ui;background:#06101a;color:#cfe8ff;padding:2rem"><h2>Jarvis</h2><p>Accès refusé. Ouvre le lien d'appairage que Jarvis t'a envoyé (Réglages → Téléphone sur le PC).</p></body>`;

export class MobileServer {
  private serveurs: Server[] = [];
  private essais = new Map<string, { n: number; debut: number }>();
  private enCours = false;

  constructor(private readonly options: MobileOptions) {}

  private now(): number {
    return this.options.maintenant?.() ?? Date.now();
  }

  async start(): Promise<{ ok: boolean; message: string; ecoutes: Array<{ host: string; port: number; niveau: Niveau }> }> {
    if (!this.options.token || this.options.token.length < 16) return { ok: false, message: "jeton trop court : le serveur mobile ne démarre pas", ecoutes: [] };
    const demarrees: Array<{ host: string; port: number; niveau: Niveau }> = [];
    const erreurs: string[] = [];
    for (const e of this.options.ecoutes) {
      const serveur = createServer((req, res) => void this.repondre(req, res, e.niveau).catch(() => this.fin(res, 500, "erreur")));
      const ok = await new Promise<boolean>((resolve) => {
        serveur.once("error", (err) => {
          erreurs.push(`${e.host}:${e.port} ${err instanceof Error ? err.message : err}`);
          resolve(false);
        });
        serveur.listen(e.port, e.host, () => resolve(true));
      });
      if (ok) {
        this.serveurs.push(serveur);
        demarrees.push(e);
      }
    }
    return { ok: demarrees.length > 0, message: demarrees.length ? `à l'écoute : ${demarrees.map((d) => `${d.host}:${d.port} (${d.niveau})`).join(", ")}${erreurs.length ? ` ; échec : ${erreurs.join(", ")}` : ""}` : `aucune écoute possible : ${erreurs.join(", ")}`, ecoutes: demarrees };
  }

  stop(): void {
    for (const s of this.serveurs) s.close();
    this.serveurs = [];
  }

  private fin(res: ServerResponse, code: number, corps: string, type = "text/plain; charset=utf-8", extra: Record<string, string> = {}): void {
    res.writeHead(code, { "content-type": type, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store", ...extra });
    res.end(corps);
  }

  private json(res: ServerResponse, code: number, objet: unknown): void {
    this.fin(res, code, JSON.stringify(objet), "application/json; charset=utf-8");
  }

  /** Trop d'essais ratés depuis la même adresse : on ferme la porte une minute. */
  private bloque(ip: string): boolean {
    const e = this.essais.get(ip);
    if (!e) return false;
    if (this.now() - e.debut > FENETRE_MS) {
      this.essais.delete(ip);
      return false;
    }
    return e.n >= ESSAIS_MAX;
  }

  private rate(ip: string): void {
    const e = this.essais.get(ip);
    if (!e || this.now() - e.debut > FENETRE_MS) this.essais.set(ip, { n: 1, debut: this.now() });
    else e.n += 1;
    if (this.essais.size > 500) this.essais.clear();
  }

  private cookieValide(req: IncomingMessage): boolean {
    const brut = req.headers.cookie ?? "";
    const m = brut.match(/(?:^|;\s*)jv=([a-f0-9]{64})/);
    return !!m && egal(m[1]!, sessionCookie(this.options.token));
  }

  private async repondre(req: IncomingMessage, res: ServerResponse, niveau: Niveau): Promise<void> {
    const ip = req.socket.remoteAddress ?? "?";
    const url = new URL(req.url ?? "/", "http://x");
    const chemin = url.pathname;
    const fichier = FICHIERS[chemin];

    // Fichiers publics (manifeste et icônes, nécessaires à « Ajouter à l'écran d'accueil »).
    if (fichier?.public && req.method === "GET") return this.servir(res, fichier);

    if (this.bloque(ip)) return this.fin(res, 429, "Trop d'essais. Réessaie dans une minute.");

    // Appairage : le jeton dans l'adresse est échangé contre un cookie, puis retiré de l'adresse.
    const jeton = url.searchParams.get("jeton");
    if (jeton !== null && req.method === "GET") {
      if (!egal(jeton, this.options.token)) {
        this.rate(ip);
        return this.fin(res, 401, PAGE_REFUS, "text/html; charset=utf-8");
      }
      return this.fin(res, 302, "", "text/plain", { location: "/", "set-cookie": `jv=${sessionCookie(this.options.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000` });
    }

    // L'en-tête x-jeton reste possible pour les outils (tests, scripts).
    const parEntete = typeof req.headers["x-jeton"] === "string" && egal(req.headers["x-jeton"], this.options.token);
    if (!this.cookieValide(req) && !parEntete) {
      this.rate(ip);
      return chemin.startsWith("/api/") ? this.json(res, 401, { erreur: "non autorisé" }) : this.fin(res, 401, PAGE_REFUS, "text/html; charset=utf-8");
    }

    if (fichier && req.method === "GET") return this.servir(res, fichier);

    if (chemin === "/api/etat" && req.method === "GET") return this.json(res, 200, { ok: true, niveau, version: this.options.version ?? "" });

    if (req.method === "POST" && (chemin === "/api/invoke" || chemin === "/api/demander")) {
      // Protection contre les requêtes venues d'un autre site : JSON obligatoire, origine = ce serveur.
      if (!/^application\/json/i.test(req.headers["content-type"] ?? "")) return this.json(res, 415, { erreur: "JSON attendu" });
      const origine = req.headers.origin;
      if (origine) {
        let memeHote = false;
        try {
          memeHote = new URL(origine).host === req.headers.host;
        } catch {
          // origine illisible (« null ») : refusée
        }
        if (!memeHote) return this.json(res, 403, { erreur: "origine refusée" });
      }
      let corps: Record<string, unknown>;
      try {
        corps = JSON.parse(await this.lire(req)) as Record<string, unknown>;
      } catch {
        return this.json(res, 400, { erreur: "JSON invalide" });
      }
      if (chemin === "/api/invoke") {
        const canal = String(corps.canal ?? "");
        const droit = canalAutorise(canal, niveau);
        if (!droit) return this.json(res, 403, { erreur: niveau === "maison" ? "Réservé à la connexion chiffrée (Tailscale)." : "Ce canal n'est pas accessible depuis le téléphone." });
        try {
          return this.json(res, 200, { ok: true, resultat: (await this.options.invoke(canal, corps.payload)) ?? null });
        } catch (error) {
          return this.json(res, 500, { erreur: error instanceof Error ? error.message : String(error) });
        }
      }
      const texte = String(corps.texte ?? "").trim().slice(0, 4000);
      if (!texte) return this.json(res, 400, { erreur: "texte manquant" });
      if (this.enCours) return this.json(res, 429, { erreur: "Une demande est déjà en cours." });
      this.enCours = true;
      try {
        return this.json(res, 200, { ok: true, reponse: await this.options.demander(texte, niveau) });
      } catch (error) {
        return this.json(res, 500, { erreur: error instanceof Error ? error.message : String(error) });
      } finally {
        this.enCours = false;
      }
    }
    return this.fin(res, 404, "introuvable");
  }

  private async servir(res: ServerResponse, f: { fichier: string; type: string }): Promise<void> {
    try {
      const data = await readFile(path.join(this.options.dossier, f.fichier));
      res.writeHead(200, { "content-type": f.type, "x-content-type-options": "nosniff", "cache-control": f.fichier.endsWith(".html") ? "no-store" : "no-cache" });
      res.end(data);
    } catch {
      this.fin(res, 404, "introuvable");
    }
  }

  private lire(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let corps = "";
      req.on("data", (c) => {
        corps += c;
        if (corps.length > MAX_CORPS) {
          reject(new Error("trop gros"));
          req.destroy();
        }
      });
      req.on("end", () => resolve(corps));
      req.on("error", reject);
    });
  }
}
