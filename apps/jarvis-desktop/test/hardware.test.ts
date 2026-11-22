import { describe, expect, it } from "vitest";
import { buildProfile, describeProfile, tune } from "../src/main/hardware.js";
import { LocalAI } from "../src/main/local-ai.js";

// Le PC d'Alex : Ryzen 7 5700G (8 cœurs, 16 threads, Radeon intégrée), 16 Go, RTX 3070 8 Go.
const alex = buildProfile({ physicalCores: 8, cores: 16 }, 16 * 1024 ** 3, [
  { vendor: "NVIDIA", model: "NVIDIA GeForce RTX 3070", vram: 8192 },
  { vendor: "Advanced Micro Devices, Inc.", model: "AMD Radeon(TM) Graphics", vram: 512 },
]);

describe("profil matériel", () => {
  it("reconnaît le Ryzen G, la puce intégrée et la RTX", () => {
    expect(alex).toEqual({ coeurs: 8, threads: 16, ramGo: 16, nvidia: { modele: "NVIDIA GeForce RTX 3070", vramMo: 8192 }, integre: { modele: "AMD Radeon(TM) Graphics" } });
  });

  it("règle Jarvis pour ce PC", () => {
    const t = tune(alex);
    expect(t).toMatchObject({ threadsNormal: 4, threadsJeu: 2, threadsVoix: 4, ollamaConseille: "qwen3:8b", pagesCacheesMs: 5 * 60_000 });
    expect(describeProfile(alex, t)).toContain("RTX 3070 (8 Go)");
  });

  it("une Radeon RX dédiée n'est pas une puce intégrée", () => {
    expect(buildProfile({ cores: 12 }, 32 * 1024 ** 3, [{ vendor: "AMD", model: "AMD Radeon RX 7800 XT", vram: 16384 }]).integre).toBeUndefined();
  });
});

describe("IA locale adaptée à la carte graphique", () => {
  const ollama = (models: Array<{ name: string; size: number }>, log: string[] = []) =>
    (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/tags")) return new Response(JSON.stringify({ models }));
      if (url.endsWith("/api/ps")) return new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }] }));
      log.push(String(init?.body));
      return new Response("{}");
    }) as unknown as typeof fetch;

  it("préfère un modèle qui tient dans les 8 Go de la RTX", async () => {
    const ai = new LocalAI({ fetchFn: ollama([{ name: "qwen3:14b", size: 9.3e9 }, { name: "qwen3:8b", size: 5.2e9 }]), vramGo: () => 8 });
    expect(await ai.pickModel()).toBe("qwen3:8b");
  });

  it("décharge les modèles de la carte graphique (mode jeu)", async () => {
    const log: string[] = [];
    const ai = new LocalAI({ fetchFn: ollama([], log) });
    expect(await ai.unloadAll()).toBe(1);
    expect(JSON.parse(log[0]!)).toEqual({ model: "qwen3:8b", keep_alive: 0 });
  });
});
