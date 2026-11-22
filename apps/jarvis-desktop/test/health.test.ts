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

describe("santé : applis Android (Health Connect Webhook)", () => {
  const lot = {
    timestamp: "2026-11-23T08:00:00Z",
    app_version: "1.0.0",
    timezone: "Europe/Paris",
    steps: [{ count: 3200, start_time: "2026-11-23T06:00:00Z", end_time: "2026-11-23T08:00:00Z" }],
    heart_rate: [{ bpm: 70, time: "2026-11-23T07:00:00Z" }, { bpm: 72, time: "2026-11-23T08:15:00Z" }],
    sleep: [{ session_end_time: "2026-11-23T06:30:00Z", duration_seconds: 27000, stages: [] }],
    active_calories: [{ calories: 120, start_time: "2026-11-23T06:00:00Z", end_time: "2026-11-23T08:00:00Z" }],
    oxygen_saturation: [{ percentage: 97, time: "2026-11-23T07:30:00Z" }],
    weight: [{ kilograms: 78.4, time: "2026-11-23T06:45:00Z" }],
    distance: [{ meters: 2500, start_time: "2026-11-23T06:00:00Z", end_time: "2026-11-23T08:00:00Z" }],
  };

  it("lit les listes par type de mesure", () => {
    const s = parsePayload(lot);
    const v = (t: string) => s.filter((x) => x.type === t).map((x) => x.valeur);
    expect(v("pas")).toEqual([3200]);
    expect(v("rythme")).toEqual([70, 72]);
    expect(v("sommeil")).toEqual([7.5]);
    expect(v("calories")).toEqual([120]);
    expect(v("spo2")).toEqual([97]);
    expect(v("poids")).toEqual([78.4]);
    expect(v("distance")).toEqual([2.5]);
  });

  it("ne double pas les pas quand l'appli renvoie le même lot", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hc-"));
    const store = new HealthStore(dir);
    expect(store.ingest(parsePayload(lot))).toBeGreaterThan(0);
    expect(store.ingest(parsePayload(lot))).toBe(0);
    const resume = store.summary(() => new Date("2026-11-23T12:00:00Z"));
    expect(resume.find((x) => x.type === "pas")?.valeur).toBe(3200);
    expect(resume.find((x) => x.type === "rythme")?.valeur).toBe(72);
  });
});
