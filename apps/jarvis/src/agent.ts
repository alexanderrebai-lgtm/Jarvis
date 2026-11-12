import Anthropic from "@anthropic-ai/sdk";
import { ConversationStore, trimHistory, type Conversation } from "./history.js";
import type { NotesRepository } from "./notes.js";
import type { PendingEntry } from "./pending.js";
import { stamp, systemPrompt } from "./prompt.js";
import { runTool, toolDefinitions, type ToolContext } from "./tools.js";

const MAX_STEPS = 15;

export interface AssistantReply {
  text: string;
  pending: PendingEntry[];
}

export interface AssistantOptions {
  model: string;
  ownerName: string;
  timeZone: string;
  dataDir: string;
  tools: ToolContext;
  notes: NotesRepository;
  client?: Anthropic;
}

type Message = Anthropic.Beta.BetaMessageParam;

export class Assistant {
  private readonly client: Anthropic;
  private readonly conversations: ConversationStore;
  private readonly tools = toolDefinitions();
  private readonly locks = new Map<string, Promise<unknown>>();
  /** Événements survenus entre deux messages (mails, SMS reçus…), transmis au message suivant. */
  private readonly inbox = new Map<string, string[]>();

  constructor(private readonly options: AssistantOptions) {
    this.client = options.client ?? new Anthropic();
    this.conversations = new ConversationStore(options.dataDir);
  }

  /** Ajoute une information de contexte que l'assistant lira avec le prochain message. */
  notify(conversationId: string, event: string): void {
    const list = this.inbox.get(conversationId) ?? [];
    list.push(event);
    this.inbox.set(conversationId, list.slice(-20));
  }

  reset(conversationId: string): void {
    this.conversations.reset(conversationId);
    this.inbox.delete(conversationId);
  }

  /** Une conversation à la fois par interlocuteur, pour garder l'historique cohérent. */
  ask(conversationId: string, text: string): Promise<AssistantReply> {
    const previous = this.locks.get(conversationId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.run(conversationId, text));
    this.locks.set(conversationId, next);
    return next;
  }

  private freshConversation(): Conversation {
    return {
      system: systemPrompt(this.options.ownerName, this.options.timeZone, this.options.notes.memories()),
      messages: [],
    };
  }

  private async run(conversationId: string, text: string): Promise<AssistantReply> {
    let conversation = this.conversations.load(conversationId) ?? this.freshConversation();
    const trimmed = trimHistory(conversation.messages);
    if (trimmed) {
      // Nouvelle « époque » : la consigne peut intégrer la mémoire à jour.
      conversation = { ...this.freshConversation(), messages: trimmed };
    }

    const events = this.inbox.get(conversationId) ?? [];
    this.inbox.delete(conversationId);
    const context = events.length ? `\n[Depuis ton dernier échange :\n${events.map((e) => `- ${e}`).join("\n")}]` : "";
    const messages: Message[] = [
      ...conversation.messages,
      { role: "user", content: `[${stamp(new Date(), this.options.timeZone)}]${context}\n${text}` },
    ];

    const created: PendingEntry[] = [];
    let reply = "";
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const response = await this.client.beta.messages.create({
        model: this.options.model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        cache_control: { type: "ephemeral" },
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system: conversation.system,
        tools: this.tools,
        messages,
      });
      messages.push({ role: "assistant", content: response.content });

      const textOut = response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();

      if (response.stop_reason === "refusal") {
        reply = textOut || "Je préfère ne pas répondre à cette demande.";
        break;
      }
      if (response.stop_reason === "pause_turn") continue;
      if (response.stop_reason === "tool_use") {
        const calls = response.content.filter(
          (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use",
        );
        const results = await Promise.all(
          calls.map(async (call) => {
            const result = await runTool(call.name, call.input, this.options.tools, created);
            const block: Anthropic.Beta.BetaToolResultBlockParam = {
              type: "tool_result",
              tool_use_id: call.id,
              content: result.image
                ? [
                    { type: "image", source: { type: "base64", media_type: result.image.mediaType, data: result.image.data } },
                    { type: "text", text: result.content },
                  ]
                : result.content,
              ...(result.isError ? { is_error: true } : {}),
            };
            return block;
          }),
        );
        messages.push({ role: "user", content: results });
        continue;
      }
      reply = textOut;
      if (response.stop_reason === "max_tokens") reply += "\n\n(Réponse coupée, demande-moi la suite.)";
      break;
    }

    if (!reply) reply = "J'ai atteint ma limite d'étapes pour cette demande. Reformule ou découpe-la.";
    // Si la boucle s'arrête sur des retours d'outils, on clôt l'échange pour que l'historique reste valide.
    if (messages.at(-1)?.role === "user") messages.push({ role: "assistant", content: reply });
    this.conversations.save(conversationId, { system: conversation.system, messages });
    return { text: reply, pending: created };
  }
}
