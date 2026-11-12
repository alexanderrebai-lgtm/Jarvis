import { existsSync } from "node:fs";
import path from "node:path";

/** Charge le fichier .env s'il existe (Node 22 sait le lire sans dépendance). */
export function loadEnvFile(file = ".env"): void {
  if (existsSync(file)) process.loadEnvFile(file);
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export interface Config {
  anthropicModel: string;
  telegramToken: string | undefined;
  /** Seul ce chat Telegram a le droit de parler à l'assistant. */
  telegramChatId: string | undefined;
  google:
    | { clientId: string; clientSecret: string; refreshToken: string }
    | undefined;
  /** Secret partagé avec les raccourcis iPhone (en-tête Authorization: Bearer). */
  webhookSecret: string | undefined;
  port: number;
  timeZone: string;
  dataDir: string;
  ownerName: string;
  gmailPollMinutes: number;
  briefingHour: number;
  briefingMinute: number;
  eventReminderMinutes: number;
  browserEnabled: boolean;
  chromiumPath: string | undefined;
  homeAssistant: { url: string; token: string } | undefined;
  tapo: { email: string; password: string; devices: string | undefined } | undefined;
}

export function readConfig(): Config {
  const clientId = optional("GOOGLE_CLIENT_ID");
  const clientSecret = optional("GOOGLE_CLIENT_SECRET");
  const refreshToken = optional("GOOGLE_REFRESH_TOKEN");
  const haUrl = optional("HOME_ASSISTANT_URL");
  const haToken = optional("HOME_ASSISTANT_TOKEN");
  const tapoEmail = optional("TAPO_EMAIL");
  const tapoPassword = optional("TAPO_PASSWORD");
  const [briefingHour, briefingMinute] = (optional("BRIEFING_TIME") ?? "07:30")
    .split(":")
    .map((part) => Number.parseInt(part, 10));
  return {
    anthropicModel: optional("ANTHROPIC_MODEL") ?? "claude-opus-5-5",
    telegramToken: optional("TELEGRAM_BOT_TOKEN"),
    telegramChatId: optional("TELEGRAM_CHAT_ID"),
    google:
      clientId && clientSecret && refreshToken
        ? { clientId, clientSecret, refreshToken }
        : undefined,
    webhookSecret: optional("WEBHOOK_SECRET"),
    port: Number.parseInt(optional("PORT") ?? "8787", 10),
    timeZone: optional("TZ") ?? "Europe/Paris",
    dataDir: path.resolve(optional("DATA_DIR") ?? "data"),
    ownerName: optional("OWNER_NAME") ?? "l'utilisateur",
    gmailPollMinutes: Number.parseInt(optional("GMAIL_POLL_MINUTES") ?? "5", 10),
    briefingHour: Number.isFinite(briefingHour) ? briefingHour! : 7,
    briefingMinute: Number.isFinite(briefingMinute) ? briefingMinute! : 30,
    eventReminderMinutes: Number.parseInt(optional("EVENT_REMINDER_MINUTES") ?? "30", 10),
    browserEnabled: (optional("BROWSER_ENABLED") ?? "true").toLowerCase() !== "false",
    chromiumPath: optional("CHROMIUM_PATH"),
    homeAssistant: haUrl && haToken ? { url: haUrl, token: haToken } : undefined,
    tapo: tapoEmail && tapoPassword ? { email: tapoEmail, password: tapoPassword, devices: optional("TAPO_DEVICES") } : undefined,
  };
}
