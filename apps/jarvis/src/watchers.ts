import type Anthropic from "@anthropic-ai/sdk";
import type { Assistant } from "./agent.js";
import { briefingDue, localParts } from "./clock.js";
import type { Config } from "./config.js";
import type { AgendaService } from "./google/agenda.js";
import type { MailService } from "./google/mail.js";
import { emailAddress } from "./mime.js";
import type { NotesRepository } from "./notes.js";
import type { PendingActions } from "./pending.js";
import { JsonStore } from "./store.js";
import { BRIEFING_PROMPT, type TelegramChannel } from "./telegram.js";
import { triage, type Triage } from "./triage.js";

interface WatchState {
  gmailHistoryId?: string;
  lastBriefingDay?: string;
  remindedEvents: Record<string, string>;
}

const IMPORTANCE_ICON: Record<Triage["importance"], string> = {
  urgent: "🔴",
  important: "🟠",
  normal: "⚪",
  ignorer: "⚪",
};

const SKIPPED_LABELS = new Set(["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "SPAM"]);

export interface WatcherDeps {
  config: Config;
  client: Anthropic;
  assistant: Assistant;
  telegram: TelegramChannel;
  notes: NotesRepository;
  pending: PendingActions;
  mail: MailService | undefined;
  agenda: AgendaService | undefined;
}

/** Surveillances automatiques : nouveaux mails, briefing du matin, rappels. */
export class Watchers {
  private readonly state: JsonStore<WatchState>;
  private timers: NodeJS.Timeout[] = [];
  private busy = new Set<string>();

  constructor(private readonly deps: WatcherDeps) {
    this.state = new JsonStore(deps.config.dataDir, "etat", () => ({ remindedEvents: {} }));
  }

  private get chatId(): string {
    return this.deps.config.telegramChatId ?? "proprietaire";
  }

  start(): void {
    const every = (name: string, ms: number, task: () => Promise<void>) => {
      const run = async () => {
        if (this.busy.has(name)) return;
        this.busy.add(name);
        try {
          await task();
        } catch (error) {
          console.error(`[${name}]`, error);
        } finally {
          this.busy.delete(name);
        }
      };
      void run();
      this.timers.push(setInterval(run, ms));
    };
    if (this.deps.mail) every("mails", this.deps.config.gmailPollMinutes * 60_000, () => this.checkMail());
    every("briefing", 60_000, () => this.checkBriefing());
    every("rappels", 60_000, () => this.checkReminders());
    if (this.deps.agenda) every("rendez-vous", 5 * 60_000, () => this.checkEvents());
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  async checkMail(): Promise<void> {
    const mail = this.deps.mail;
    if (!mail) return;
    const state = this.state.read();
    if (!state.gmailHistoryId) {
      // Premier lancement : on ne traite que les mails qui arriveront ensuite.
      this.state.write({ ...state, gmailHistoryId: await mail.currentHistoryId() });
      return;
    }
    let result: { ids: string[]; historyId: string };
    try {
      result = await mail.newInboxMessagesSince(state.gmailHistoryId);
    } catch {
      // Historique trop ancien (serveur arrêté longtemps) : on repart d'aujourd'hui.
      this.state.update((s) => ({ ...s, gmailHistoryId: undefined }));
      return;
    }
    for (const id of result.ids.slice(0, 10)) await this.handleMail(mail, id);
    this.state.update((s) => ({ ...s, gmailHistoryId: result.historyId }));
  }

  private async handleMail(mail: MailService, id: string): Promise<void> {
    const { config } = this.deps;
    const message = await mail.read(id);
    // Pubs et réseaux sociaux : pas d'analyse (ni de coût) inutile.
    if (message.labels.some((label) => SKIPPED_LABELS.has(label))) return;
    const analysis = await triage(this.deps.client, config.anthropicModel, config.ownerName, config.timeZone, this.deps.notes.memories(), {
      canal: "mail",
      de: message.from,
      objet: message.subject,
      contenu: message.body || message.snippet,
    });
    this.deps.assistant.notify(
      this.chatId,
      `Mail reçu de ${message.from}, objet « ${message.subject} » (id ${message.id}) : ${analysis.resume}`,
    );
    if (analysis.importance === "ignorer" || analysis.importance === "normal") return;

    const header = `${IMPORTANCE_ICON[analysis.importance]} Mail de ${message.from}\n« ${message.subject} »\n\n${analysis.resume}${analysis.action ? `\n👉 ${analysis.action}` : ""}${analysis.suspect ? "\n⚠️ Ça ressemble à une arnaque : ne clique sur aucun lien." : ""}`;
    if (analysis.reponse_proposee && !analysis.suspect) {
      const entry = this.deps.pending.create({
        kind: "send_email",
        to: emailAddress(message.from),
        subject: /^re\s*:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`,
        body: analysis.reponse_proposee,
        threadId: message.threadId,
        inReplyTo: message.messageId,
        references: [message.references, message.messageId].filter(Boolean).join(" "),
      });
      await this.deps.telegram.sendPending(entry, `${header}\n\nRéponse proposée (ou dis-moi quoi changer) :`);
    } else {
      await this.deps.telegram.send(header);
    }
  }

  async checkBriefing(): Promise<void> {
    const { config } = this.deps;
    const state = this.state.read();
    const now = new Date();
    if (!briefingDue(now, config.timeZone, config.briefingHour, config.briefingMinute, state.lastBriefingDay)) return;
    // Pas de briefing rattrapé l'après-midi si le serveur a redémarré tard.
    if (localParts(now, config.timeZone).hour >= 12) {
      this.state.update((s) => ({ ...s, lastBriefingDay: localParts(now, config.timeZone).day }));
      return;
    }
    this.state.update((s) => ({ ...s, lastBriefingDay: localParts(now, config.timeZone).day }));
    const reply = await this.deps.assistant.ask(this.chatId, BRIEFING_PROMPT);
    await this.deps.telegram.send(`☀️ ${reply.text}`);
  }

  async checkReminders(): Promise<void> {
    for (const note of this.deps.notes.dueReminders()) {
      await this.deps.telegram.send(`⏰ Rappel : ${note.texte}`);
      this.deps.notes.markReminderSent(note.id);
    }
  }

  async checkEvents(): Promise<void> {
    const agenda = this.deps.agenda;
    if (!agenda) return;
    const now = new Date();
    const horizon = new Date(now.getTime() + (this.deps.config.eventReminderMinutes + 5) * 60_000);
    const events = await agenda.list(now, horizon);
    const state = this.state.read();
    const reminded = { ...state.remindedEvents };
    for (const event of events) {
      if (event.allDay || reminded[event.id]) continue;
      const start = new Date(event.start);
      const minutes = Math.round((start.getTime() - now.getTime()) / 60_000);
      if (minutes > this.deps.config.eventReminderMinutes) continue;
      reminded[event.id] = event.start;
      const time = start.toLocaleTimeString("fr-FR", { timeZone: this.deps.config.timeZone, hour: "2-digit", minute: "2-digit" });
      await this.deps.telegram.send(`📅 Dans ${minutes} min (${time}) : ${event.summary}${event.location ? `\n📍 ${event.location}` : ""}`);
    }
    // On oublie les rappels de plus de deux jours.
    const limit = now.getTime() - 2 * 24 * 3600_000;
    for (const [id, start] of Object.entries(reminded)) if (new Date(start).getTime() < limit) delete reminded[id];
    this.state.update((s) => ({ ...s, remindedEvents: reminded }));
  }
}
