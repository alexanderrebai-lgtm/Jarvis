import { JsonStore } from "@muscu/jarvis/src/store.js";
import * as webpushModule from "web-push";

type WebPush = typeof import("web-push");
/** web-push est un module CommonJS : selon l'outil (assemblage ou tests), la fonctionnalité est dans « default » ou à la racine. */
export const webpush: WebPush = ((webpushModule as unknown as { default?: WebPush }).default ?? webpushModule) as WebPush;

/**
 * Notifications push sur le téléphone (Web Push, standard du navigateur).
 *
 * Le PC envoie un message CHIFFRÉ de bout en bout (RFC 8291) au service push du
 * téléphone (Apple pour un iPhone) : le service ne voit que « quelqu'un a envoyé
 * quelque chose à cet appareil », pas le contenu. Le service worker de l'appli le
 * déchiffre et l'affiche.
 *
 * Vie privée : par défaut le contenu est DISCRET (« Ouvre Jarvis pour voir »),
 * parce qu'une notification s'affiche sur l'écran verrouillé.
 */

export type ContenuPush = "off" | "discret" | "complet";

export interface Abonnement {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  creeLe: string;
}

export interface Notif {
  titre: string;
  corps: string;
  url?: string;
  tag?: string;
  /** Alerte qui doit sortir tout de suite (surveillance, accord demandé). */
  urgent?: boolean;
}

interface Etat {
  abonnements: Abonnement[];
  vapid?: { publicKey: string; privateKey?: string };
}

/** Seuls les vrais services push sont acceptés : on n'envoie jamais à une adresse quelconque. */
const SERVICES_PUSH = /(^|\.)((fcm|android)\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/i;
const MAX_ABONNEMENTS = 8;
const CORPS_DISCRET = "Ouvre Jarvis pour voir.";

export interface PushOptions {
  dataDir: string;
  /** Coffre-fort (Windows) pour la clé privée ; sinon elle reste dans le dossier de données. */
  secret?: { get: (k: string) => string | undefined; set: (k: string, v: string | undefined) => void } | undefined;
  contenu: () => ContenuPush;
  /** Test : accepte d'autres adresses que les vrais services push. */
  hotesAutorises?: RegExp;
  /** Test : remplace l'envoi réseau. */
  envoi?: (a: Abonnement, charge: string, o: { TTL: number; urgency: "high" | "normal" }) => Promise<{ statusCode: number }>;
  maintenant?: () => number;
}

export interface ResultatEnvoi {
  envoyes: number;
  retires: number;
  erreurs: string[];
}

export class PushService {
  private readonly store: JsonStore<Etat>;
  private recents = new Map<string, number>();

  constructor(private readonly o: PushOptions) {
    this.store = new JsonStore(o.dataDir, "push", () => ({ abonnements: [] }));
  }

  private now(): number {
    return this.o.maintenant?.() ?? Date.now();
  }

  /** Clés VAPID (l'identité du PC auprès du service push) : créées une fois, gardées. */
  private vapid(): { publicKey: string; privateKey: string } {
    const s = this.store.read();
    const privee = s.vapid?.privateKey ?? this.o.secret?.get("push-vapid-prive");
    if (s.vapid && privee) return { publicKey: s.vapid.publicKey, privateKey: privee };
    const k = webpush.generateVAPIDKeys();
    if (this.o.secret) {
      this.o.secret.set("push-vapid-prive", k.privateKey);
      this.store.update((x) => ({ ...x, vapid: { publicKey: k.publicKey } }));
    } else this.store.update((x) => ({ ...x, vapid: { publicKey: k.publicKey, privateKey: k.privateKey } }));
    return k;
  }

  cle(): string {
    return this.vapid().publicKey;
  }

  nombre(): number {
    return this.store.read().abonnements.length;
  }

  /** Enregistre l'abonnement du téléphone ; refuse tout ce qui n'est pas un vrai service push. */
  abonner(brut: unknown): boolean {
    const s = brut as Partial<Abonnement> | undefined;
    const endpoint = typeof s?.endpoint === "string" ? s.endpoint : "";
    const p256dh = s?.keys?.p256dh;
    const auth = s?.keys?.auth;
    if (!endpoint || typeof p256dh !== "string" || typeof auth !== "string" || !p256dh || !auth || endpoint.length > 1000) return false;
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      return false;
    }
    if (url.protocol !== "https:" || !(this.o.hotesAutorises ?? SERVICES_PUSH).test(url.hostname)) return false;
    const a: Abonnement = { endpoint, keys: { p256dh, auth }, creeLe: new Date(this.now()).toISOString() };
    this.store.update((x) => ({ ...x, abonnements: [...x.abonnements.filter((y) => y.endpoint !== endpoint), a].slice(-MAX_ABONNEMENTS) }));
    return true;
  }

  desabonner(endpoint: string): void {
    this.store.update((x) => ({ ...x, abonnements: x.abonnements.filter((y) => y.endpoint !== endpoint) }));
  }

  /** Envoie à tous les téléphones abonnés. Un abonnement mort (404/410) est retiré tout seul. */
  async envoyer(n: Notif, options: { forcer?: boolean } = {}): Promise<ResultatEnvoi> {
    const res: ResultatEnvoi = { envoyes: 0, retires: 0, erreurs: [] };
    const mode = this.o.contenu();
    if (mode === "off" && !options.forcer) return res;
    const abonnes = this.store.read().abonnements;
    if (!abonnes.length) return res;
    const cle = n.tag ?? `${n.titre}|${n.corps}`;
    const dernier = this.recents.get(cle);
    if (!options.forcer && dernier !== undefined && this.now() - dernier < 60_000) return res; // pas deux fois la même en une minute
    this.recents.set(cle, this.now());
    if (this.recents.size > 100) this.recents.clear();
    const charge = JSON.stringify({ titre: n.titre.slice(0, 80), corps: mode === "complet" || options.forcer ? n.corps.slice(0, 200) : CORPS_DISCRET, url: n.url ?? "/", ...(n.tag ? { tag: n.tag } : {}) });
    const opts = { TTL: n.urgent ? 600 : 3600, urgency: n.urgent ? ("high" as const) : ("normal" as const) };
    for (const a of abonnes) {
      try {
        const r = await (this.o.envoi ?? this.envoiReel.bind(this))(a, charge, opts);
        if (r.statusCode >= 200 && r.statusCode < 300) res.envoyes += 1;
        else if (r.statusCode === 404 || r.statusCode === 410) (this.desabonner(a.endpoint), (res.retires += 1));
        else res.erreurs.push(`HTTP ${r.statusCode}`);
      } catch (error) {
        const code = (error as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          this.desabonner(a.endpoint);
          res.retires += 1;
        } else res.erreurs.push(error instanceof Error ? error.message.slice(0, 120) : String(error));
      }
    }
    return res;
  }

  private async envoiReel(a: Abonnement, charge: string, o: { TTL: number; urgency: "high" | "normal" }): Promise<{ statusCode: number }> {
    const v = this.vapid();
    // « mailto » générique : le service push exige un contact, on n'y met aucune information personnelle.
    return webpush.sendNotification({ endpoint: a.endpoint, keys: a.keys }, charge, { TTL: o.TTL, urgency: o.urgency, vapidDetails: { subject: "mailto:jarvis-local@example.com", publicKey: v.publicKey, privateKey: v.privateKey } });
  }
}
