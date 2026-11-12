import { JsonStore, newId } from "./store.js";

/**
 * Actions sensibles (envoyer un mail, supprimer un rendez-vous…) : l'assistant
 * les prépare, mais elles ne partent qu'après ton accord explicite.
 */
export type PendingAction =
  | { kind: "send_email"; to: string; subject: string; body: string; cc?: string; threadId?: string; inReplyTo?: string; references?: string }
  | { kind: "delete_event"; eventId: string; summary: string };

export interface PendingEntry {
  id: string;
  action: PendingAction;
  createdAt: string;
  status: "pending" | "done" | "cancelled" | "failed";
}

const MAX_AGE_MS = 48 * 60 * 60 * 1000;

export class PendingActions {
  private readonly store: JsonStore<PendingEntry[]>;

  constructor(dataDir: string, private readonly now: () => Date = () => new Date()) {
    this.store = new JsonStore(dataDir, "actions-en-attente", () => []);
  }

  create(action: PendingAction): PendingEntry {
    const entry: PendingEntry = { id: newId("act"), action, createdAt: this.now().toISOString(), status: "pending" };
    const limit = this.now().getTime() - MAX_AGE_MS;
    this.store.update((all) => [...all.filter((e) => new Date(e.createdAt).getTime() > limit), entry]);
    return entry;
  }

  get(id: string): PendingEntry | undefined {
    return this.store.read().find((entry) => entry.id === id);
  }

  /** Prend l'action si elle est encore en attente, et la marque pour qu'elle ne parte qu'une fois. */
  claim(id: string): PendingEntry | undefined {
    const entry = this.get(id);
    if (!entry || entry.status !== "pending") return undefined;
    if (this.now().getTime() - new Date(entry.createdAt).getTime() > MAX_AGE_MS) return undefined;
    this.setStatus(id, "done");
    return entry;
  }

  setStatus(id: string, status: PendingEntry["status"]): void {
    this.store.update((all) => all.map((entry) => (entry.id === id ? { ...entry, status } : entry)));
  }
}

export function describeAction(action: PendingAction): string {
  switch (action.kind) {
    case "send_email":
      return `✉️ Mail à ${action.to}${action.cc ? ` (cc ${action.cc})` : ""}\nObjet : ${action.subject}\n\n${action.body}`;
    case "delete_event":
      return `🗑️ Supprimer le rendez-vous « ${action.summary} »`;
  }
}
