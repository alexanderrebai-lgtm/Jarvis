import type Anthropic from "@anthropic-ai/sdk";
import { JsonStore } from "./store.js";

type Message = Anthropic.Beta.BetaMessageParam;

export interface Conversation {
  system: string;
  messages: Message[];
}

/** Au-delà de MAX_MESSAGES, on ne garde que les échanges récents (KEEP_MESSAGES environ). */
const MAX_MESSAGES = 80;
const KEEP_MESSAGES = 30;

/** Un vrai message de l'utilisateur (texte), par opposition à un retour d'outil. */
function isUserTurnStart(message: Message): boolean {
  if (message.role !== "user") return false;
  if (typeof message.content === "string") return true;
  return message.content.every((block) => block.type !== "tool_result");
}

/**
 * Raccourcit l'historique en coupant entre deux échanges complets. Les blocs de
 * raisonnement sont retirés partout : ils sont liés à l'historique exact qui les
 * a produits, et une coupure au début le modifie. Renvoie undefined si rien à faire.
 */
export function trimHistory(messages: Message[]): Message[] | undefined {
  if (messages.length <= MAX_MESSAGES) return undefined;
  let start = messages.length - KEEP_MESSAGES;
  while (start < messages.length && !isUserTurnStart(messages[start]!)) start += 1;
  if (start >= messages.length) return undefined;
  return messages.slice(start).map((message) => {
    if (message.role !== "assistant" || typeof message.content === "string") return message;
    const content = message.content.filter((block) => block.type !== "thinking" && block.type !== "redacted_thinking");
    return { ...message, content: content.length ? content : [{ type: "text", text: "…" }] };
  });
}

export class ConversationStore {
  constructor(private readonly dataDir: string) {}

  private store(id: string): JsonStore<Conversation | null> {
    return new JsonStore<Conversation | null>(`${this.dataDir}/conversations`, id.replace(/[^\w-]/g, "_"), () => null);
  }

  load(id: string): Conversation | null {
    return this.store(id).read();
  }

  save(id: string, conversation: Conversation): void {
    this.store(id).write(conversation);
  }

  reset(id: string): void {
    this.store(id).write(null);
  }
}
