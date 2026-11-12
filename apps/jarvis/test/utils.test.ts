import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { briefingDue, localParts } from "../src/clock.js";
import { trimHistory } from "../src/history.js";
import { buildRawMail, emailAddress, extractText } from "../src/mime.js";
import { NotesRepository } from "../src/notes.js";
import { PendingActions } from "../src/pending.js";
import { isAuthorized } from "../src/server.js";
import { freeSlots } from "../src/slots.js";
import { splitMessage } from "../src/telegram.js";

const tempDir = () => mkdtempSync(path.join(tmpdir(), "jarvis-"));

describe("mime", () => {
  it("encode un mail en UTF-8 lisible par Gmail", () => {
    const raw = buildRawMail({ to: "paul@example.com", subject: "Réunion demain", body: "À demain !", inReplyTo: "<a@b>" });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("To: paul@example.com");
    expect(decoded).toContain(`Subject: =?UTF-8?B?${Buffer.from("Réunion demain").toString("base64")}?=`);
    expect(decoded).toContain("In-Reply-To: <a@b>");
    const body = decoded.split("\r\n\r\n")[1]!;
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("À demain !");
  });

  it("empêche l'injection d'en-têtes", () => {
    const decoded = Buffer.from(buildRawMail({ to: "a@b.c\r\nBcc: pirate@x.y", subject: "s", body: "b" }), "base64url").toString();
    expect(decoded).not.toMatch(/\r\nBcc:/);
  });

  it("extrait le texte brut, sinon le HTML", () => {
    const html = { mimeType: "text/html", body: { data: Buffer.from("<p>Bonjour&nbsp;Alex</p><br>Merci").toString("base64url") } };
    expect(extractText({ mimeType: "multipart/alternative", parts: [html] })).toBe("Bonjour Alex\n\nMerci");
    const plain = { mimeType: "text/plain", body: { data: Buffer.from("Salut").toString("base64url") } };
    expect(extractText({ mimeType: "multipart/alternative", parts: [html, plain] })).toBe("Salut");
    expect(emailAddress("Paul Martin <paul@example.com>")).toBe("paul@example.com");
  });
});

describe("notes et mémoire", () => {
  it("cherche sans tenir compte des accents et envoie les rappels une seule fois", () => {
    let now = new Date("2026-11-12T08:00:00Z");
    const notes = new NotesRepository(tempDir(), () => now);
    notes.add("Appeler le garagiste pour la révision", ["voiture"], "2026-11-12T09:00:00Z");
    notes.add("Idée cadeau : livre de cuisine");
    expect(notes.search("revision garagiste")).toHaveLength(1);
    expect(notes.search("VOITURE")).toHaveLength(1);
    expect(notes.dueReminders()).toHaveLength(0);
    now = new Date("2026-11-12T09:01:00Z");
    const [due] = notes.dueReminders();
    expect(due!.texte).toMatch(/garagiste/);
    notes.markReminderSent(due!.id);
    expect(notes.dueReminders()).toHaveLength(0);
    const fact = notes.remember("Sa sœur s'appelle Léa");
    expect(notes.memories()).toHaveLength(1);
    expect(notes.forget(fact.id)).toBe(true);
  });
});

describe("actions en attente", () => {
  it("une action ne s'exécute qu'une fois, et pas après annulation", () => {
    const pending = new PendingActions(tempDir());
    const entry = pending.create({ kind: "delete_event", eventId: "e1", summary: "Dentiste" });
    expect(pending.claim(entry.id)?.id).toBe(entry.id);
    expect(pending.claim(entry.id)).toBeUndefined();
    const other = pending.create({ kind: "delete_event", eventId: "e2", summary: "Sport" });
    pending.setStatus(other.id, "cancelled");
    expect(pending.claim(other.id)).toBeUndefined();
  });

  it("une action expire après 48 h", () => {
    let now = new Date("2026-11-10T08:00:00Z");
    const pending = new PendingActions(tempDir(), () => now);
    const entry = pending.create({ kind: "delete_event", eventId: "e1", summary: "x" });
    now = new Date("2026-11-12T09:00:00Z");
    expect(pending.claim(entry.id)).toBeUndefined();
  });
});

describe("créneaux libres", () => {
  it("trouve les trous entre les rendez-vous, chevauchements compris", () => {
    const d = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 12, h, m));
    const slots = freeSlots(
      [
        { start: d(10), end: d(11) },
        { start: d(10, 30), end: d(12) },
        { start: d(14), end: d(14, 20) },
      ],
      d(9),
      d(18),
      30,
    );
    expect(slots.map((s) => [s.start.getUTCHours(), s.minutes])).toEqual([
      [9, 60],
      [12, 120],
      [14, 220],
    ]);
  });
});

describe("historique", () => {
  it("coupe entre deux échanges et retire les blocs de raisonnement", () => {
    const messages = [];
    for (let i = 0; i < 30; i += 1) {
      messages.push({ role: "user" as const, content: `question ${i}` });
      messages.push({
        role: "assistant" as const,
        content: [
          { type: "thinking" as const, thinking: "", signature: "sig" },
          { type: "tool_use" as const, id: `t${i}`, name: "notes_chercher", input: {} },
        ],
      });
      messages.push({ role: "user" as const, content: [{ type: "tool_result" as const, tool_use_id: `t${i}`, content: "[]" }] });
    }
    expect(trimHistory(messages.slice(0, 60))).toBeUndefined();
    const trimmed = trimHistory(messages)!;
    expect(trimmed.length).toBeLessThanOrEqual(30);
    expect(typeof trimmed[0]!.content).toBe("string");
    expect(JSON.stringify(trimmed)).not.toContain('"thinking"');
  });
});

describe("horloge", () => {
  it("donne l'heure de Paris et décide du briefing", () => {
    const now = new Date("2026-11-12T06:45:00Z"); // 7 h 45 à Paris
    expect(localParts(now, "Europe/Paris")).toEqual({ day: "2026-11-12", hour: 7, minute: 45 });
    expect(briefingDue(now, "Europe/Paris", 7, 30, undefined)).toBe(true);
    expect(briefingDue(now, "Europe/Paris", 7, 30, "2026-11-12")).toBe(false);
    expect(briefingDue(now, "Europe/Paris", 8, 0, undefined)).toBe(false);
  });
});

describe("serveur", () => {
  it("n'accepte que le bon secret", () => {
    expect(isAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(isAuthorized("Bearer faux", "s3cret")).toBe(false);
    expect(isAuthorized(undefined, "s3cret")).toBe(false);
    expect(isAuthorized("Bearer ", undefined)).toBe(false);
  });
});

describe("telegram", () => {
  it("découpe les longs messages", () => {
    const parts = splitMessage(`${"a".repeat(30)}\n${"b".repeat(30)}`, 40);
    expect(parts).toEqual(["a".repeat(30), "b".repeat(30)]);
  });
});
