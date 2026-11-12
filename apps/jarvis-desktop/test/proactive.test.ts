import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NotesRepository } from "@muscu/jarvis/src/notes.js";
import { describe, expect, it } from "vitest";
import { Proactive } from "../src/main/proactive.js";

function setup(now: Date, overrides: Record<string, unknown> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "jarvis-pro-"));
  const said: string[] = [];
  const asked: string[] = [];
  const notes = new NotesRepository(dir, () => now);
  const proactive = new Proactive({
    dataDir: dir,
    timeZone: "Europe/Paris",
    ownerName: "Alex",
    briefing: { hour: 7, minute: 30 },
    eventReminderMinutes: 15,
    notes,
    agenda: undefined,
    mail: undefined,
    brain: { ask: async (prompt: string) => (asked.push(prompt), { text: "Bonjour Alex, grand soleil." }) },
    say: (text) => said.push(text),
    notify: () => undefined,
    canSpeak: () => true,
    now: () => now,
    ...overrides,
  });
  return { proactive, said, asked, notes };
}

describe("Jarvis proactif", () => {
  it("dit les rappels à l'heure, une seule fois", async () => {
    const now = new Date("2026-11-12T09:00:00Z");
    const { proactive, said, notes } = setup(now);
    notes.add("Appeler le garage", [], "2026-11-12T08:59:00Z");
    await proactive.reminders();
    await proactive.reminders();
    expect(said).toEqual(["Alex, petit rappel : Appeler le garage"]);
  });

  it("fait le briefing du matin une fois par jour, pas l'après-midi", async () => {
    const morning = setup(new Date("2026-11-12T06:45:00Z"));
    await morning.proactive.morning();
    await morning.proactive.morning();
    expect(morning.asked).toHaveLength(1);
    expect(morning.said).toEqual(["Bonjour Alex, grand soleil."]);

    const afternoon = setup(new Date("2026-11-12T14:00:00Z"));
    await afternoon.proactive.morning();
    expect(afternoon.asked).toHaveLength(0);
  });

  it("se tait en mode ne pas déranger", async () => {
    const now = new Date("2026-11-12T09:00:00Z");
    const { proactive, said, notes } = setup(now, { canSpeak: () => false });
    notes.add("Boire de l'eau", [], "2026-11-12T08:00:00Z");
    await proactive.reminders();
    expect(said).toEqual([]);
  });

  it("annonce un rendez-vous imminent", async () => {
    const now = new Date("2026-11-12T09:00:00Z");
    const agenda = {
      list: async () => [{ id: "e1", summary: "Point équipe", start: "2026-11-12T09:10:00Z", end: "", allDay: false, location: "Salle 2", description: "", attendees: [], link: "" }],
    };
    const { proactive, said } = setup(now, { agenda });
    await proactive.events();
    await proactive.events();
    expect(said).toEqual(["Alex, Point équipe dans 10 minutes, à Salle 2."]);
  });
});
