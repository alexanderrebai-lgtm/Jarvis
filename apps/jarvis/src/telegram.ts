import { Bot, InlineKeyboard } from "grammy";
import type { Assistant } from "./agent.js";
import { executePending } from "./executor.js";
import type { AgendaService } from "./google/agenda.js";
import type { MailService } from "./google/mail.js";
import type { NotesRepository } from "./notes.js";
import { describeAction, type PendingActions, type PendingEntry } from "./pending.js";

const LIMIT = 4000;

export function splitMessage(text: string, limit = LIMIT): string[] {
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

export interface TelegramDeps {
  token: string;
  ownerChatId: string | undefined;
  assistant: Assistant;
  pending: PendingActions;
  notes: NotesRepository;
  mail: MailService | undefined;
  agenda: AgendaService | undefined;
}

export class TelegramChannel {
  readonly bot: Bot;

  constructor(private readonly deps: TelegramDeps) {
    this.bot = new Bot(deps.token);
    this.setup();
  }

  private isOwner(chatId: number | undefined): boolean {
    return chatId !== undefined && String(chatId) === this.deps.ownerChatId;
  }

  private setup(): void {
    const { bot, deps } = this;

    // Personne d'autre que toi ne peut parler à ton assistant.
    bot.use(async (ctx, next) => {
      const chatId = ctx.chat?.id;
      if (!deps.ownerChatId) {
        await ctx.reply(
          `Bonjour ! Pour me relier à toi, ajoute cette ligne dans le fichier .env puis redémarre-moi :\nTELEGRAM_CHAT_ID=${chatId}`,
        );
        return;
      }
      if (!this.isOwner(chatId)) return;
      await next();
    });

    bot.command("start", (ctx) =>
      ctx.reply(
        "Je suis Jarvis. Écris-moi naturellement : « qu'est-ce que j'ai demain ? », « réponds à Paul que je serai en retard », « aide-moi à choisir entre ces deux offres »…\n\n/nouveau : repartir de zéro\n/notes : tes dernières notes\n/briefing : le point du jour",
      ),
    );

    bot.command("nouveau", async (ctx) => {
      deps.assistant.reset(String(ctx.chat.id));
      await ctx.reply("C'est noté, on repart de zéro. Je garde ta mémoire et tes notes.");
    });

    bot.command("notes", async (ctx) => {
      const notes = deps.notes.list(10);
      await ctx.reply(notes.length ? notes.map((n) => `• ${n.texte}`).join("\n") : "Aucune note pour l'instant.");
    });

    bot.command("briefing", (ctx) => this.handleText(String(ctx.chat.id), BRIEFING_PROMPT));

    bot.on("message:text", (ctx) => this.handleText(String(ctx.chat.id), ctx.message.text));

    bot.on("message:voice", (ctx) =>
      ctx.reply("Je ne lis pas encore les vocaux : utilise la dictée du clavier (le micro), ça marche très bien."),
    );

    bot.on("callback_query:data", async (ctx) => {
      const [verb, id] = ctx.callbackQuery.data.split(":");
      if (!id) return ctx.answerCallbackQuery();
      if (verb === "ok") {
        await ctx.answerCallbackQuery({ text: "C'est parti…" });
        const result = await executePending(id, deps.pending, { mail: deps.mail, agenda: deps.agenda });
        await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => undefined);
        await ctx.reply(result);
        deps.assistant.notify(String(ctx.chat?.id), `Action ${id} confirmée par l'utilisateur : ${result}`);
      } else if (verb === "no") {
        deps.pending.setStatus(id, "cancelled");
        await ctx.answerCallbackQuery({ text: "Annulé" });
        await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() }).catch(() => undefined);
        deps.assistant.notify(String(ctx.chat?.id), `Action ${id} annulée par l'utilisateur.`);
      } else {
        await ctx.answerCallbackQuery();
      }
    });

    bot.catch((error) => console.error("[telegram]", error.error));
  }

  private async handleText(chatId: string, text: string): Promise<void> {
    const typing = setInterval(() => void this.bot.api.sendChatAction(chatId, "typing").catch(() => undefined), 4500);
    void this.bot.api.sendChatAction(chatId, "typing").catch(() => undefined);
    try {
      const reply = await this.deps.assistant.ask(chatId, text);
      await this.send(reply.text);
      for (const entry of reply.pending) await this.sendPending(entry);
    } catch (error) {
      console.error("[assistant]", error);
      await this.send("Oups, j'ai eu un problème technique. Réessaie dans un instant.");
    } finally {
      clearInterval(typing);
    }
  }

  /** Envoie un message au propriétaire (utilisé aussi par les surveillances automatiques). */
  async send(text: string, keyboard?: InlineKeyboard): Promise<void> {
    if (!this.deps.ownerChatId) return;
    const parts = splitMessage(text);
    for (const [index, part] of parts.entries()) {
      const last = index === parts.length - 1;
      await this.bot.api.sendMessage(this.deps.ownerChatId, part, last && keyboard ? { reply_markup: keyboard } : {});
    }
  }

  async sendPending(entry: PendingEntry, intro?: string): Promise<void> {
    const label = entry.action.kind === "send_email" ? "✅ Envoyer" : "✅ Confirmer";
    const keyboard = new InlineKeyboard().text(label, `ok:${entry.id}`).text("❌ Annuler", `no:${entry.id}`);
    await this.send(`${intro ? `${intro}\n\n` : ""}${describeAction(entry.action)}`, keyboard);
  }

  private stopping = false;

  start(): void {
    this.bot
      .start({ onStart: (me) => console.log(`[telegram] connecté en tant que @${me.username}`) })
      .catch((error: unknown) => {
        if (this.stopping) return;
        console.error("[telegram] impossible de se connecter (vérifie TELEGRAM_BOT_TOKEN) :", error);
        process.exit(1);
      });
  }

  stop(): Promise<void> {
    this.stopping = true;
    return this.bot.stop();
  }
}

export const BRIEFING_PROMPT =
  "Fais-moi le point du jour, court et utile : mes rendez-vous d'aujourd'hui (et demain matin s'il y a quelque chose de tôt), les mails non lus importants des dernières 24 h avec ce qui demande une action, mes rappels du jour, et un conseil pour organiser ma journée.";
