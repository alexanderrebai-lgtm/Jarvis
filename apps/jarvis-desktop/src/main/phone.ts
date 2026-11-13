/**
 * Alertes sur le téléphone par Telegram (photo + texte), pour la surveillance
 * complète et les tâches importantes. Il faut le jeton d'un bot (@BotFather) et
 * l'identifiant de ta conversation avec lui.
 */

/** Vrai pour un identifiant de conversation Telegram (un nombre, parfois négatif). */
export function isTelegramChatId(value: string | undefined): boolean {
  return /^-?\d{3,}$/.test(value?.trim() ?? "");
}

/** Vrai pour un jeton de bot (« 123456789:AA… » donné par @BotFather). */
export function isTelegramToken(value: string | undefined): boolean {
  return /^\d{5,}:[\w-]{30,}$/.test(value?.trim() ?? "");
}

/** Erreurs Telegram expliquées en français. */
export function explainTelegram(status: number, detail = ""): string {
  const d = detail.toLowerCase();
  if (status === 401 || status === 404) return "Telegram refuse le jeton du bot : recopie-le depuis @BotFather (il ressemble à 123456789:AAH…), enregistre, puis réessaie.";
  if (d.includes("chat not found")) return "Telegram ne trouve pas ta conversation : l'identifiant doit être un nombre (pas le nom du bot). Envoie « bonjour » à ton bot dans Telegram, puis clique sur « Trouver ma conversation ».";
  if (d.includes("bot can't initiate") || d.includes("forbidden") || status === 403) return "Le bot n'a pas le droit de t'écrire : ouvre ton bot dans Telegram, appuie sur « Démarrer » (ou envoie-lui « bonjour »), puis réessaie.";
  if (status === 429) return "Telegram demande de patienter un peu avant le prochain message.";
  return `Telegram a refusé le message (erreur ${status}${detail ? ` : ${detail}` : ""}).`;
}

export class PhoneAlerts {
  constructor(private readonly options: { token?: string | undefined; chatId?: string | undefined; fetchFn?: typeof fetch }) {}

  get enabled(): boolean {
    return Boolean(this.options.token && this.options.chatId);
  }

  private async call(method: string, body: FormData | Record<string, unknown>): Promise<void> {
    if (!this.enabled) return;
    const fetchFn = this.options.fetchFn ?? fetch;
    const init: RequestInit = body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    const res = await fetchFn(`https://api.telegram.org/bot${this.options.token}/${method}`, { ...init, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      const detail = ((await res.json().catch(() => ({}))) as { description?: string }).description ?? "";
      throw new Error(explainTelegram(res.status, detail));
    }
  }

  async text(message: string): Promise<void> {
    await this.call("sendMessage", { chat_id: this.options.chatId, text: message });
  }

  async photo(jpeg: Buffer, caption: string): Promise<void> {
    const form = new FormData();
    form.set("chat_id", String(this.options.chatId));
    form.set("caption", caption.slice(0, 1000));
    form.set("photo", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "alerte.jpg");
    await this.call("sendPhoto", form);
  }
}
