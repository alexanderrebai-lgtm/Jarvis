import type { gmail_v1 } from "@googleapis/gmail";
import { buildRawMail, extractText, type OutgoingMail } from "../mime.js";

export interface MailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
  messageId: string;
  labels: string[];
}

function header(message: gmail_v1.Schema$Message, name: string): string {
  return message.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function summarize(message: gmail_v1.Schema$Message): MailSummary {
  return {
    id: message.id ?? "",
    threadId: message.threadId ?? "",
    from: header(message, "From"),
    to: header(message, "To"),
    subject: header(message, "Subject"),
    date: header(message, "Date"),
    snippet: message.snippet ?? "",
    unread: message.labelIds?.includes("UNREAD") ?? false,
    messageId: header(message, "Message-ID"),
    labels: message.labelIds ?? [],
  };
}

export class MailService {
  constructor(private readonly api: gmail_v1.Gmail) {}

  /** Recherche avec la syntaxe Gmail (ex. « is:unread newer_than:2d », « from:banque »). */
  async search(query: string, max = 10): Promise<MailSummary[]> {
    const list = await this.api.users.messages.list({ userId: "me", q: query, maxResults: Math.min(max, 25) });
    const ids = (list.data.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    const messages = await Promise.all(
      ids.map((id) =>
        this.api.users.messages.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["From", "To", "Subject", "Date", "Message-ID"],
        }),
      ),
    );
    return messages.map((m) => summarize(m.data));
  }

  async read(id: string): Promise<MailSummary & { body: string; references: string }> {
    const { data } = await this.api.users.messages.get({ userId: "me", id, format: "full" });
    const body = extractText(data.payload);
    return {
      ...summarize(data),
      body: body.length > 12000 ? `${body.slice(0, 12000)}\n[… mail tronqué]` : body,
      references: header(data, "References"),
    };
  }

  async send(mail: OutgoingMail & { threadId?: string }): Promise<string> {
    const { data } = await this.api.users.messages.send({
      userId: "me",
      requestBody: { raw: buildRawMail(mail), ...(mail.threadId ? { threadId: mail.threadId } : {}) },
    });
    return data.id ?? "";
  }

  async createDraft(mail: OutgoingMail & { threadId?: string }): Promise<string> {
    const { data } = await this.api.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw: buildRawMail(mail), ...(mail.threadId ? { threadId: mail.threadId } : {}) } },
    });
    return data.id ?? "";
  }

  async modifyLabels(id: string, change: { markRead?: boolean; archive?: boolean; star?: boolean }): Promise<void> {
    const removeLabelIds: string[] = [];
    const addLabelIds: string[] = [];
    if (change.markRead) removeLabelIds.push("UNREAD");
    if (change.archive) removeLabelIds.push("INBOX");
    if (change.star) addLabelIds.push("STARRED");
    await this.api.users.messages.modify({ userId: "me", id, requestBody: { addLabelIds, removeLabelIds } });
  }

  /** Identifiant d'historique actuel, pour ne surveiller que les nouveaux mails. */
  async currentHistoryId(): Promise<string> {
    const { data } = await this.api.users.getProfile({ userId: "me" });
    return data.historyId ?? "";
  }

  /** Nouveaux mails arrivés en boîte de réception depuis un identifiant d'historique. */
  async newInboxMessagesSince(historyId: string): Promise<{ ids: string[]; historyId: string }> {
    const ids = new Set<string>();
    let pageToken: string | undefined;
    let latest = historyId;
    do {
      const { data } = await this.api.users.history.list({
        userId: "me",
        startHistoryId: historyId,
        historyTypes: ["messageAdded"],
        labelId: "INBOX",
        ...(pageToken ? { pageToken } : {}),
      });
      for (const entry of data.history ?? []) {
        for (const added of entry.messagesAdded ?? []) {
          const labels = added.message?.labelIds ?? [];
          if (added.message?.id && labels.includes("INBOX") && !labels.includes("SENT")) ids.add(added.message.id);
        }
      }
      latest = data.historyId ?? latest;
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
    return { ids: [...ids], historyId: latest };
  }
}
