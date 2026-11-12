import Anthropic from "@anthropic-ai/sdk";
import { Assistant } from "./agent.js";
import { WebBrowser } from "./browser.js";
import { loadEnvFile, readConfig } from "./config.js";
import { AgendaService } from "./google/agenda.js";
import { createGoogleClients } from "./google/client.js";
import { MailService } from "./google/mail.js";
import { HomeAssistant } from "./home.js";
import { Inbox } from "./inbox.js";
import { parseDeviceList, realTapoDriver, TapoHome } from "./tapo.js";
import { createMcpServer } from "./mcp.js";
import { NotesRepository } from "./notes.js";
import { PendingActions } from "./pending.js";
import { createWebhookServer } from "./server.js";
import { TelegramChannel } from "./telegram.js";
import type { ToolContext } from "./tools.js";
import { triage } from "./triage.js";
import { Watchers } from "./watchers.js";

/**
 * Deux façons d'utiliser Jarvis, cumulables :
 * - Mode abonnement : l'app Claude (iPhone, web) se branche sur le connecteur /mcp.
 *   C'est ton abonnement Claude qui paie, aucune clé API n'est nécessaire.
 * - Mode automatique : avec une clé API, Jarvis surveille tes mails, t'écrit sur
 *   Telegram, envoie le briefing du matin et répond à Siri, même quand tu ne lui parles pas.
 */

loadEnvFile();
const config = readConfig();

const notes = new NotesRepository(config.dataDir);
const pending = new PendingActions(config.dataDir);
const inbox = new Inbox(config.dataDir);
const google = config.google ? createGoogleClients(config.google) : undefined;
const mail = google ? new MailService(google.gmail) : undefined;
const agenda = google ? new AgendaService(google.calendar, config.timeZone) : undefined;
const browser = config.browserEnabled ? new WebBrowser({ dataDir: config.dataDir, executablePath: config.chromiumPath }) : undefined;
const home = config.homeAssistant ? new HomeAssistant(config.homeAssistant.url, config.homeAssistant.token) : undefined;
const tapo = config.tapo
  ? new TapoHome(realTapoDriver(config.tapo.email, config.tapo.password, parseDeviceList(config.tapo.devices)))
  : undefined;
const tools: ToolContext = { mail, agenda, notes, pending, inbox, browser, home, tapo };

if (!google) console.warn("Google non connecté : outils Gmail et Agenda absents (lance « pnpm google-auth »).");

const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const automatic = hasApiKey && Boolean(config.telegramToken);
if (!automatic) {
  console.log("Mode abonnement seul : ajoute ANTHROPIC_API_KEY et TELEGRAM_BOT_TOKEN pour les automatismes.");
}
if (!config.webhookSecret) {
  console.error("WEBHOOK_SECRET manquant : il protège le connecteur et les raccourcis (voir README).");
  process.exit(1);
}

let telegram: TelegramChannel | undefined;
let watchers: Watchers | undefined;
let assistant: Assistant | undefined;
let client: Anthropic | undefined;
const ownerConversation = config.telegramChatId ?? "proprietaire";

if (automatic) {
  client = new Anthropic();
  assistant = new Assistant({
    model: config.anthropicModel,
    ownerName: config.ownerName,
    timeZone: config.timeZone,
    dataDir: config.dataDir,
    notes,
    client,
    tools,
  });
  telegram = new TelegramChannel({
    token: config.telegramToken!,
    ownerChatId: config.telegramChatId,
    assistant,
    pending,
    notes,
    mail,
    agenda,
  });
  watchers = new Watchers({ config, client, assistant, telegram, notes, pending, mail, agenda });
}

const server = createWebhookServer(config.webhookSecret, {
  createMcp: () => createMcpServer(tools, config.ownerName),
  onIncoming: async (message) => {
    inbox.add(message);
    if (!client || !assistant || !telegram) return { recu: true };
    const analysis = await triage(client, config.anthropicModel, config.ownerName, config.timeZone, notes.memories(), {
      canal: message.app ?? "SMS",
      de: message.de,
      contenu: message.contenu,
    });
    assistant.notify(ownerConversation, `${message.app ?? "SMS"} reçu de ${message.de} : « ${message.contenu.slice(0, 500)} »`);
    if (analysis.importance === "urgent" || analysis.importance === "important" || analysis.suspect) {
      await telegram.send(
        `📱 ${message.app ?? "SMS"} de ${message.de}\n${analysis.resume}${analysis.suspect ? "\n⚠️ Message suspect : ne réponds pas et ne clique sur rien." : ""}${analysis.reponse_proposee ? `\n\nRéponse proposée :\n${analysis.reponse_proposee}` : ""}`,
      );
    }
    return { recu: true, ...analysis };
  },
  ...(assistant && telegram
    ? {
        onAsk: async (text: string) => {
          const reply = await assistant!.ask(ownerConversation, text);
          for (const entry of reply.pending) await telegram!.sendPending(entry, "À confirmer :");
          return { reponse: reply.text, a_confirmer: reply.pending.length };
        },
      }
    : {}),
});

server.listen(config.port, () => {
  console.log(`[serveur] port ${config.port} : connecteur Claude sur /mcp/<WEBHOOK_SECRET>, raccourcis iPhone sur /message`);
});
telegram?.start();
if (config.telegramChatId) watchers?.start();

const shutdown = async () => {
  watchers?.stop();
  server.close();
  await browser?.close();
  await telegram?.stop().catch(() => undefined);
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
