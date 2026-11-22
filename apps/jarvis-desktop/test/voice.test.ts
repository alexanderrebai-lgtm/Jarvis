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

  it("lance le serveur de voix depuis une copie hors de l'archive de l'application", async () => {
    if (process.platform === "win32") return;
    const { LocalVoice } = await import("../src/main/local-voice.js");
    const { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const ws = mkdtempSync(path.join(tmpdir(), "voix-"));
    const assets = mkdtempSync(path.join(tmpdir(), "assets-"));
    mkdirSync(path.join(assets, "voix"));
    writeFileSync(path.join(assets, "voix", "serveur_voix.py"), "# serveur");
    // Faux Python : note le script reçu et annonce qu'il est prêt.
    const bin = path.join(ws, "voix", ".venv", "bin");
    mkdirSync(bin, { recursive: true });
    const log = path.join(ws, "argv.txt");
    writeFileSync(path.join(bin, "python"), `#!/bin/sh\necho "$1" > ${log}\necho '{"pret": true, "appareil": "cuda"}'\nsleep 5\n`);
    chmodSync(path.join(bin, "python"), 0o755);
    writeFileSync(path.join(ws, "voix", ".installee"), "x");
    const lv = new LocalVoice(ws, { assetsDir: assets, findPython: async () => undefined });
    expect(await lv.start()).toBe(true);
    lv.stop();
    const script = readFileSync(log, "utf8").trim();
    expect(script).toBe(path.join(ws, "voix", "serveur_voix.py"));
    expect(existsSync(script)).toBe(true);
    expect(lv.device).toBe("cuda");
  });
});

describe("erreurs Python de la voix locale", () => {
  it("résume la trace Python en une ligne utile", async () => {
    const { summarizePythonError } = await import("../src/main/local-voice.js");
    const trace = `Traceback (most recent call last):
  File "C:\\Users\\a\\Documents\\Jarvis\\voix\\serveur_voix.py", line 52, in <module>
    model = ChatterboxMultilingualTTS.from_pretrained(device=device)
  File "C:\\Users\\a\\Documents\\Jarvis\\voix\\.venv\\Lib\\site-packages\\chatterbox\\mtl_tts.py", line 180, in __init__
    self.watermarker = perth.PerthImplicitWatermarker()
                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
TypeError: 'NoneType' object is not callable`;
    expect(summarizePythonError(trace)).toBe("TypeError: 'NoneType' object is not callable (dans chatterbox/mtl_tts.py, ligne 180). Détails : Documents\\Jarvis\\voix\\serveur.log");
  });
});

describe("voix locale économe", () => {
  it("ne fait jamais attendre : modèle pas prêt = voix en ligne, chargement en arrière-plan", async () => {
    const { LocalVoice } = await import("../src/main/local-voice.js");
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const ws = mkdtempSync(path.join(tmpdir(), "voix-"));
    mkdirSync(path.join(ws, "voix", ".venv", "bin"), { recursive: true });
    mkdirSync(path.join(ws, "voix", ".venv", "Scripts"), { recursive: true });
    writeFileSync(path.join(ws, "voix", ".installee"), "x");
    let fetched = 0;
    const lv = new LocalVoice(ws, { assetsDir: "x", findPython: async () => undefined, fetchFn: (async () => (fetched++, new Response("RIFF"))) as unknown as typeof fetch });
    let started = 0;
    (lv as unknown as { start: () => Promise<boolean> }).start = async () => (started++, false);
    const t0 = Date.now();
    expect(await lv.synthesize("Bonjour")).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(200);
    expect(started).toBe(1);
    expect(fetched).toBe(0);
  });
});
