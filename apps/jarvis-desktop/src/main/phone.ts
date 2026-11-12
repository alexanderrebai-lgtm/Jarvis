/**
 * Alertes sur le téléphone par Telegram (photo + texte), pour la surveillance
 * complète et les tâches importantes. Il faut le jeton d'un bot (@BotFather) et
 * l'identifiant de ta conversation avec lui.
 */

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
    if (!res.ok) throw new Error(`Telegram : erreur ${res.status}`);
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
