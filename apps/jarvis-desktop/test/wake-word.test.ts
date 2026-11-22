import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WakeWordEngine } from "../src/main/wake-word.js";

// Enregistrements de test (voix de synthèse, 16 kHz, 16 bits) : « hey jarvis » et une phrase française sans le mot.
const pcm = (name: string) => {
  const b = readFileSync(path.join(__dirname, "fixtures", name));
  return new Int16Array(b.buffer, b.byteOffset, b.length / 2);
};

async function run(engine: WakeWordEngine, voice: Int16Array): Promise<number> {
  const quiet = new Int16Array(16_000);
  const clip = new Int16Array(quiet.length * 2 + voice.length);
  clip.set(voice, quiet.length);
  let hits = 0;
  // Comme le micro : des petits blocs au fil de l'eau.
  for (let i = 0; i < clip.length; i += 683) {
    engine.push(clip.slice(i, i + 683), () => (hits += 1));
    await engine.idle();
  }
  return hits;
}

describe("mot d'éveil « Hey Jarvis »", () => {
  it("entend « hey jarvis » une seule fois, et pas une phrase ordinaire", async () => {
    const engine = await WakeWordEngine.load(path.join(__dirname, "..", "assets", "eveil"), { threshold: 0.5 });
    expect(await run(engine, pcm("hey-jarvis.pcm"))).toBe(1);
    expect(engine.maxScore).toBeGreaterThan(0.9);
    await new Promise((r) => setTimeout(r, 2100));
    engine.maxScore = 0;
    expect(await run(engine, pcm("phrase-fr.pcm"))).toBe(0);
    expect(engine.maxScore).toBeLessThan(0.1);
  }, 60_000);
});
