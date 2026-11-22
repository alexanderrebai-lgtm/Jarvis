import { describe, expect, it } from "vitest";
import { cpuLoad, parseNvidiaLine } from "../src/main/perf.js";

const t = (user: number, sys: number, idle: number) => ({ user, nice: 0, sys, idle, irq: 0 });

describe("mesures rapides", () => {
  it("calcule la charge du processeur entre deux lectures, sans programme externe", () => {
    const load = cpuLoad([t(100, 50, 850), t(0, 0, 1000)], [t(400, 150, 1450), t(50, 50, 1900)]);
    expect(load.coeurs).toEqual([40, 10]);
    expect(load.total).toBe(25);
  });

  it("lit une ligne de nvidia-smi", () => {
    expect(parseNvidiaLine("NVIDIA GeForce RTX 3070, 97, 6144, 8192, 71, 60, 212.34")).toEqual({ modele: "NVIDIA GeForce RTX 3070", chargePct: 97, memoireUtiliseeGo: 6, memoireTotaleGo: 8, temperatureC: 71, ventilateurPct: 60, puissanceW: 212.3 });
    expect(parseNvidiaLine("NVIDIA GeForce RTX 3070, 3, 512, 8192, 40, [N/A], [N/A]")).toMatchObject({ chargePct: 3, temperatureC: 40 });
    expect(parseNvidiaLine("")).toBeUndefined();
  });
});
