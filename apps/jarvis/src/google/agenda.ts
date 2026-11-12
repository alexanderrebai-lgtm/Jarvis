import type { calendar_v3 } from "@googleapis/calendar";
import { freeSlots, type Slot } from "../slots.js";

export interface EventSummary {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  description: string;
  attendees: string[];
  link: string;
}

function toSummary(event: calendar_v3.Schema$Event): EventSummary {
  return {
    id: event.id ?? "",
    summary: event.summary ?? "(sans titre)",
    start: event.start?.dateTime ?? event.start?.date ?? "",
    end: event.end?.dateTime ?? event.end?.date ?? "",
    allDay: Boolean(event.start?.date && !event.start?.dateTime),
    location: event.location ?? "",
    description: (event.description ?? "").slice(0, 500),
    attendees: (event.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
    link: event.htmlLink ?? "",
  };
}

export interface NewEvent {
  titre: string;
  debut: string;
  fin: string;
  lieu?: string;
  description?: string;
  invites?: string[];
  journeeEntiere?: boolean;
}

export class AgendaService {
  constructor(private readonly api: calendar_v3.Calendar, private readonly timeZone: string) {}

  async list(from: Date, to: Date, query?: string): Promise<EventSummary[]> {
    const { data } = await this.api.events.list({
      calendarId: "primary",
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 100,
      ...(query ? { q: query } : {}),
    });
    return (data.items ?? []).filter((e) => e.status !== "cancelled").map(toSummary);
  }

  private body(event: Partial<NewEvent>): calendar_v3.Schema$Event {
    const time = (value: string | undefined) =>
      value === undefined ? undefined : event.journeeEntiere ? { date: value.slice(0, 10) } : { dateTime: value, timeZone: this.timeZone };
    const start = time(event.debut);
    const end = time(event.fin);
    return {
      ...(event.titre !== undefined ? { summary: event.titre } : {}),
      ...(event.lieu !== undefined ? { location: event.lieu } : {}),
      ...(event.description !== undefined ? { description: event.description } : {}),
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      ...(event.invites ? { attendees: event.invites.map((email) => ({ email })) } : {}),
    };
  }

  async create(event: NewEvent): Promise<EventSummary> {
    const { data } = await this.api.events.insert({ calendarId: "primary", requestBody: this.body(event) });
    return toSummary(data);
  }

  async update(id: string, change: Partial<NewEvent>): Promise<EventSummary> {
    const { data } = await this.api.events.patch({ calendarId: "primary", eventId: id, requestBody: this.body(change) });
    return toSummary(data);
  }

  async get(id: string): Promise<EventSummary> {
    const { data } = await this.api.events.get({ calendarId: "primary", eventId: id });
    return toSummary(data);
  }

  async remove(id: string): Promise<void> {
    await this.api.events.delete({ calendarId: "primary", eventId: id });
  }

  async freeSlots(from: Date, to: Date, minMinutes: number): Promise<Slot[]> {
    const { data } = await this.api.freebusy.query({
      requestBody: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] },
    });
    const busy = (data.calendars?.primary?.busy ?? [])
      .filter((b) => b.start && b.end)
      .map((b) => ({ start: new Date(b.start!), end: new Date(b.end!) }));
    return freeSlots(busy, from, to, minMinutes);
  }
}
