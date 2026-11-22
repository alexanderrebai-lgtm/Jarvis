import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HealthServer, HealthStore, parsePayload, toType } from "../src/main/health.js";

describe("santé : lecture des formats", () => {
  it("reconnaît les noms de mesure (FR/EN, Apple/Health Connect)", () => {
    expect(toType("HKQuantityTypeIdentifierStepCount")).toBe("pas");
    expect(toType("resting_heart_rate")).toBe("rythme-repos");
    expect(toType("heart_rate")).toBe("rythme");
    expect(toType("Sommeil")).toBe("sommeil");
    expect(toType("truc inconnu")).toBeUndefined();
  });

  it("lit le format Health Auto Export, l'objet simple et la liste", () => {
    const hae = parsePayload({ data: { metrics: [{ name: "step_count", units: "count", data: [{ date: "2026-11-23 08:00:00", qty: 3200 }, { date: "2026-11-23 10:00:00", qty: 5400 }] }, { name: "heart_rate", units: "bpm", data: [{ date: "2026-11-23 10:00:00", Avg: 64 }] }] } });
    expect(hae.find((s) => s.type === "pas")?.valeur).toBe(5400);
    expect(hae.find((s) => s.type === "rythme")?.valeur).toBe(64);
    expect(parsePayload({ pas: 8000, rythme: 62, blabla: 1 }).map((s) => s.type).sort()).toEqual(["pas", "rythme"]);
    expect(parsePayload([{ type: "poids", valeur: 74.2 }])[0]).toMatchObject({ type: "poids", valeur: 74.2 });
  });
});

describe("santé : magasin", () => {
  it("somme les pas du jour et garde la dernière valeur du rythme", () => {
    const store = new HealthStore(mkdtempSync(path.join(tmpdir(), "sante-")));
    const now = () => new Date("2026-11-23T12:00:00Z");
    store.ingest([
      { type: "pas", valeur: 3000, instant: "2026-11-23T08:00:00Z" },
      { type: "pas", valeur: 2000, instant: "2026-11-23T10:00:00Z" },
      { type: "pas", valeur: 9999, instant: "2026-11-22T10:00:00Z" },
      { type: "rythme", valeur: 70, instant: "2026-11-23T09:00:00Z" },
      { type: "rythme", valeur: 61, instant: "2026-11-23T11:00:00Z" },
    ]);
    const sum = store.summary(now);
    expect(sum.find((s) => s.type === "pas")?.valeur).toBe(5000);
    expect(sum.find((s) => s.type === "rythme")?.valeur).toBe(61);
    expect(store.phrase(now)).toContain("bpm");
  });
});

describe("santé : serveur", () => {
  it("reçoit un POST avec le bon jeton et refuse sans", async () => {
    const store = new HealthStore(mkdtempSync(path.join(tmpdir(), "sante-")));
    const server = new HealthServer(store, { port: 8961, token: "secret" });
    expect((await server.start()).ok).toBe(true);
    const bad = await fetch("http://127.0.0.1:8961/sante", { method: "POST", body: "{}" });
    expect(bad.status).toBe(401);
    const ok = await fetch("http://127.0.0.1:8961/sante", { method: "POST", headers: { "x-jeton": "secret" }, body: JSON.stringify({ pas: 1234, rythme: 58 }) });
    expect(ok.status).toBe(200);
    expect(store.summary().length).toBe(2);
    server.stop();
  });
});
