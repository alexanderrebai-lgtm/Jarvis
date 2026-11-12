import { JsonStore, newId } from "./store.js";

/** Messages reçus sur le téléphone (SMS, WhatsApp partagé…), transmis par les raccourcis iPhone. */
export interface ReceivedMessage {
  id: string;
  app: string;
  de: string;
  contenu: string;
  recuLe: string;
}

const MAX_KEPT = 300;

export class Inbox {
  private readonly store: JsonStore<ReceivedMessage[]>;

  constructor(dataDir: string, private readonly now: () => Date = () => new Date()) {
    this.store = new JsonStore(dataDir, "messages-recus", () => []);
  }

  add(message: { app?: string; de: string; contenu: string }): ReceivedMessage {
    const entry: ReceivedMessage = {
      id: newId("msg"),
      app: message.app ?? "SMS",
      de: message.de,
      contenu: message.contenu,
      recuLe: this.now().toISOString(),
    };
    this.store.update((all) => [...all, entry].slice(-MAX_KEPT));
    return entry;
  }

  /** Messages des dernières heures, du plus récent au plus ancien, filtrés par expéditeur si demandé. */
  recent(hours = 24, from?: string): ReceivedMessage[] {
    const limit = this.now().getTime() - hours * 3600_000;
    const who = from?.toLowerCase();
    return this.store
      .read()
      .filter((m) => new Date(m.recuLe).getTime() >= limit && (!who || m.de.toLowerCase().includes(who)))
      .reverse();
  }
}
