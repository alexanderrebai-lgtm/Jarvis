/** Découpe un long texte en messages de 4000 caractères au plus (Telegram en accepte 4096), de préférence à un saut de ligne. */
export function splitMessage(text: string, limit = 4000): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = rest.lastIndexOf(" ", limit);
    if (cut < limit / 2) cut = limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Telegram dans les deux sens : tu écris (ou tu envoies un message vocal) à ton
 * bot, Jarvis répond. Les vocaux sont transcrits sur le PC (Whisper) : l'audio
 * ne va nulle part ailleurs que chez Telegram, qui l'a déjà.
 *
 * Sécurité :
 *  - seule TA conversation privée appairée est écoutée : tout le reste est ignoré
 *    en silence (on ne répond pas, pour ne pas révéler que le bot est branché) ;
 *  - les messages anciens (Jarvis éteint) ne sont pas exécutés d'un coup au démarrage ;
 *  - par défaut, « questions seulement » : un compte Telegram piraté (échange de carte SIM)
 *    ne doit pas donner la main sur le PC. L'option « agir » est un choix explicite.
 */

export interface TelegramInboxOptions {
  token: () => string | undefined;
  chatId: () => string | undefined;
  /** Faux : on n'écoute pas (réglage désactivé). */
  actif: () => boolean;
  /** Pose la question au cerveau (le droit d'agir est décidé par l'appelant). */
  repondre: (texte: string, origine: "texte" | "vocal") => Promise<string>;
  /** Transcrit un message vocal (octets OGG/Opus) en texte ; undefined si impossible. */
  transcrire: (audio: Buffer) => Promise<string | undefined>;
  /** Clic sur un bouton sous un message (approbations). */
  surBouton?: (data: string) => Promise<void> | void;
  fetchFn?: typeof fetch;
  maintenant?: () => number;
  /** Attente (ms) après une erreur ; réglable pour les tests. */
  attenteErreurMs?: number;
}

export interface Update {
  update_id: number;
  message?: {
    date: number;
    text?: string;
    chat: { id: number; type: string };
    from?: { id: number };
    voice?: { file_id: string; duration: number; file_size?: number };
  };
  callback_query?: { id: string; data?: string; from: { id: number }; message?: { chat: { id: number; type: string } } };
}

const MAX_VOCAL_S = 120;
const MAX_VOCAL_OCTETS = 8_000_000;
const MESSAGE_TROP_VIEUX_S = 300;

export class TelegramInbox {
  private running = false;
  private offset: number | undefined;
  etat: "arret" | "ok" | "conflit" | "erreur" = "arret";
  derniereErreur: string | undefined;
  recus = 0;

  constructor(private readonly o: TelegramInboxOptions) {}

  private now(): number {
    return this.o.maintenant?.() ?? Date.now();
  }

  private async api<T>(methode: string, corps: Record<string, unknown>, delaiMs = 20_000): Promise<T> {
    const token = this.o.token();
    if (!token) throw new Error("pas de jeton");
    const res = await (this.o.fetchFn ?? fetch)(`https://api.telegram.org/bot${token}/${methode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps), signal: AbortSignal.timeout(delaiMs) });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (!res.ok || json.ok === false) throw Object.assign(new Error(json.description ?? `erreur ${res.status}`), { statut: res.status });
    return json.result as T;
  }

  private async envoyer(texte: string): Promise<void> {
    const chat = this.o.chatId();
    for (const morceau of splitMessage(texte || "…")) await this.api("sendMessage", { chat_id: Number(chat), text: morceau });
  }

  /** Message de ta conversation privée appairée, et de personne d'autre. */
  private autorise(chat?: { id: number; type: string }, from?: { id: number }): boolean {
    const attendu = this.o.chatId()?.trim();
    return !!attendu && !!chat && chat.type === "private" && String(chat.id) === attendu && (!from || String(from.id) === attendu);
  }

  /** Une relève des messages ; rend le nombre de mises à jour lues. */
  async sonder(attenteLongue = 25): Promise<number> {
    const updates = await this.api<Update[]>("getUpdates", { ...(this.offset !== undefined ? { offset: this.offset } : {}), timeout: attenteLongue, allowed_updates: ["message", "callback_query"] }, (attenteLongue + 10) * 1000);
    for (const u of updates) {
      this.offset = u.update_id + 1;
      try {
        await this.traiter(u);
      } catch (error) {
        this.derniereErreur = error instanceof Error ? error.message : String(error);
      }
    }
    return updates.length;
  }

  async traiter(u: Update): Promise<void> {
    if (u.callback_query) {
      const c = u.callback_query;
      if (!this.autorise(c.message?.chat, c.from)) return;
      await this.api("answerCallbackQuery", { callback_query_id: c.id }).catch(() => undefined);
      if (c.data) await this.o.surBouton?.(c.data);
      return;
    }
    const m = u.message;
    if (!m || !this.autorise(m.chat, m.from)) return;
    this.recus += 1;
    if (this.now() / 1000 - m.date > MESSAGE_TROP_VIEUX_S) {
      await this.envoyer("Je viens de me réveiller : ce message date d'il y a un moment, je ne l'exécute pas. Renvoie-le si c'est encore utile.");
      return;
    }
    let texte = m.text?.trim();
    let origine: "texte" | "vocal" = "texte";
    if (texte === "/start") return void (await this.envoyer("Jarvis ici. Écris-moi, ou envoie-moi un message vocal."));
    if (m.voice) {
      if (m.voice.duration > MAX_VOCAL_S || (m.voice.file_size ?? 0) > MAX_VOCAL_OCTETS) return void (await this.envoyer(`Ton vocal est trop long (${MAX_VOCAL_S} secondes au plus).`));
      await this.api("sendChatAction", { chat_id: m.chat.id, action: "typing" }).catch(() => undefined);
      const audio = await this.telecharger(m.voice.file_id);
      texte = audio ? await this.o.transcrire(audio).catch(() => undefined) : undefined;
      if (!texte?.trim()) return void (await this.envoyer("Je n'ai pas réussi à comprendre ce vocal. Peux-tu répéter, ou l'écrire ?"));
      texte = texte.trim();
      origine = "vocal";
      await this.envoyer(`🎙 J'ai compris : « ${texte} »`);
    }
    if (!texte) return;
    await this.api("sendChatAction", { chat_id: m.chat.id, action: "typing" }).catch(() => undefined);
    const reponse = await this.o.repondre(texte, origine).catch((e) => `Je n'ai pas pu répondre : ${e instanceof Error ? e.message : e}`);
    await this.envoyer(reponse);
  }

  private async telecharger(fileId: string): Promise<Buffer | undefined> {
    const f = await this.api<{ file_path?: string }>("getFile", { file_id: fileId });
    if (!f.file_path) return undefined;
    const res = await (this.o.fetchFn ?? fetch)(`https://api.telegram.org/file/bot${this.o.token()}/${f.file_path}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return undefined;
    const octets = Buffer.from(await res.arrayBuffer());
    return octets.length > MAX_VOCAL_OCTETS ? undefined : octets;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void (async () => {
      let attente = this.o.attenteErreurMs ?? 8_000;
      while (this.running) {
        if (!this.o.actif() || !this.o.token() || !this.o.chatId()) {
          this.etat = "arret";
          await new Promise((r) => setTimeout(r, 10_000).unref?.());
          continue;
        }
        try {
          // Au tout premier tour, on saute ce qui a été écrit pendant que Jarvis était éteint.
          if (this.offset === undefined) {
            const anciens = await this.api<Update[]>("getUpdates", { offset: -1, timeout: 0 });
            this.offset = anciens.length ? anciens[anciens.length - 1]!.update_id + 1 : 0;
          }
          await this.sonder();
          this.etat = "ok";
          this.derniereErreur = undefined;
          attente = this.o.attenteErreurMs ?? 8_000;
        } catch (error) {
          const e = error as Error & { statut?: number };
          this.derniereErreur = e.message;
          this.etat = e.statut === 409 ? "conflit" : "erreur";
          if (e.statut === 409) this.derniereErreur = "Un autre programme lit déjà ce bot Telegram (Jarvis serveur ?). Une seule application peut le faire.";
          await new Promise((r) => setTimeout(r, e.statut === 409 ? 30_000 : attente).unref?.());
          attente = Math.min(attente * 2, 60_000);
        }
      }
    })();
  }

  stop(): void {
    this.running = false;
    this.etat = "arret";
  }
}
