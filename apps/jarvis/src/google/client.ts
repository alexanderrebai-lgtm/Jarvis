import { auth, gmail, type gmail_v1 } from "@googleapis/gmail";
import { calendar, type calendar_v3 } from "@googleapis/calendar";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
];

export interface GoogleClients {
  gmail: gmail_v1.Gmail;
  calendar: calendar_v3.Calendar;
}

export function createGoogleClients(creds: { clientId: string; clientSecret: string; refreshToken: string }): GoogleClients {
  const oauth = new auth.OAuth2(creds.clientId, creds.clientSecret);
  oauth.setCredentials({ refresh_token: creds.refreshToken });
  return {
    gmail: gmail({ version: "v1", auth: oauth }),
    calendar: calendar({ version: "v3", auth: oauth }),
  };
}
