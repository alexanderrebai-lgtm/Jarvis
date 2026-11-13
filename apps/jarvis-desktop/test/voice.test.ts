import { describe, expect, it } from "vitest";
import { cleanTranscript, SentenceSplitter, speakable } from "../src/main/voice.js";

describe("voix", () => {
  it("prépare un texte à lire à voix haute", () => {
    expect(speakable("**C'est fait** ✅ Voir [le site](https://exemple.fr) ou https://a.b/c")).toBe("C'est fait Voir le site ou le lien affiché");
    expect(speakable("Voici :\n```python\nprint(1)\n```")).toBe("Voici : (le code est affiché à l'écran)");
  });

  it("découpe la réponse en phrases au fil de l'eau", () => {
    const splitter = new SentenceSplitter();
    expect(splitter.push("Bonjour Alex. Il fait 7")).toEqual(["Bonjour Alex."]);
    expect(splitter.push(",5 degrés dehors ! Je")).toEqual(["Il fait 7,5 degrés dehors !"]);
    expect(splitter.push(" ferme les volets")).toEqual([]);
    expect(splitter.flush()).toEqual(["Je ferme les volets"]);
  });

  it("écarte les phrases inventées par Whisper sur du silence", () => {
    expect(cleanTranscript(" Sous-titrage ST' 501 ")).toBe("");
    expect(cleanTranscript("[Musique]")).toBe("");
    expect(cleanTranscript(" Jarvis, allume la lumière. ")).toBe("Jarvis, allume la lumière.");
  });
});

describe("voix locale", () => {
  it("passe d'abord par la voix locale, sinon reprend la voix en ligne", async () => {
    const { Voice } = await import("../src/main/voice.js");
    const v = new Voice();
    let localOk = true;
    v.local = { active: () => true, synthesize: async () => (localOk ? Buffer.from("RIFFlocal") : undefined) };
    const a = await v.synthesize("Bonjour Alex, comment vas-tu ce matin ?");
    expect(a).toEqual({ data: Buffer.from("RIFFlocal"), mime: "audio/wav" });
    expect(v.mode).toBe("locale");
    localOk = false;
    v.local.active = () => false;
    expect(v.mode).not.toBe("locale");
  });

  it("le serveur local reçoit le texte, la référence et l'expressivité", async () => {
    const { LocalVoice } = await import("../src/main/local-voice.js");
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const ws = mkdtempSync(path.join(tmpdir(), "voix-"));
    const bodies: string[] = [];
    const fetchFn = (async (_u: string | URL, init?: RequestInit) => (bodies.push(String(init?.body)), new Response(new Uint8Array([82, 73, 70, 70])))) as unknown as typeof fetch;
    const lv = new LocalVoice(ws, { assetsDir: "x", findPython: async () => undefined, fetchFn });
    expect(lv.installed).toBe(false);
    expect(await lv.synthesize("test")).toBeUndefined(); // pas installée : la voix en ligne prend le relais
    expect(await lv.install()).toContain("Python n'est pas installé");
    // Simule un serveur déjà prêt.
    mkdirSync(path.join(ws, "voix", ".venv"), { recursive: true });
    writeFileSync(path.join(ws, "voix", ".installee"), "x");
    (lv as unknown as { status: string }).status = "prete";
    (lv as unknown as { server: { exitCode: null } }).server = { exitCode: null };
    const wav = await lv.synthesize("Bonjour", { reference: "C:/ref.wav", expressivite: 0.6 });
    expect(wav?.toString()).toBe("RIFF");
    expect(JSON.parse(bodies[0]!)).toEqual({ texte: "Bonjour", reference: "C:/ref.wav", expressivite: 0.6 });
  });
});
