import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { psString, runPowerShell } from "./pc.js";

/**
 * Voix de Jarvis : voix neuronale féminine de Microsoft (la même que la lecture
 * à voix haute d'Edge), avec repli sur la voix de Windows hors connexion.
 * Oreilles : Whisper, exécuté sur le PC (rien n'est envoyé ailleurs pour transcrire).
 */

export const DEFAULT_VOICE = "fr-FR-VivienneMultilingualNeural";

/** Texte prêt à être lu : sans Markdown, liens ni émojis. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " (le code est affiché à l'écran) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "le lien affiché")
    .replace(/[*_#>|~]+/g, " ")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Découpe en phrases complètes pour commencer à parler avant la fin de la réponse. */
export class SentenceSplitter {
  private buffer = "";

  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    const pattern = /^([\s\S]*?[.!?…:;])(\s+|$)(?=\S|$)/;
    for (;;) {
      const match = this.buffer.match(pattern);
      if (!match || match[0].length === this.buffer.length) break;
      const sentence = match[1]!.trim();
      this.buffer = this.buffer.slice(match[0].length);
      if (sentence.length > 1) out.push(sentence);
    }
    return out;
  }

  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest ? [rest] : [];
  }
}

export class Voice {
  private tts: MsEdgeTTS | undefined;
  /** Après une panne de la voix en ligne, on passe 5 minutes sur la voix de Windows (pas d'attente à chaque phrase). */
  private offlineUntil = 0;
  private readonly cache = new Map<string, { data: Buffer; mime: string }>();
  failures = 0;
  lastError: string | undefined;
  /** Voix locale (carte graphique), essayée d'abord quand elle est choisie. */
  local: { active: () => boolean; synthesize: (text: string) => Promise<Buffer | undefined> } | undefined;

  constructor(private readonly voiceName = DEFAULT_VOICE, private readonly rate = "+0%", private readonly pitch = "+0Hz") {}

  get mode(): "locale" | "en ligne" | "secours Windows" {
    if (this.local?.active()) return "locale";
    return Date.now() < this.offlineUntil ? "secours Windows" : "en ligne";
  }

  /** Renvoie l'audio (mp3 ou wav) d'une phrase, prêt à être joué par l'interface. */
  async synthesize(text: string): Promise<{ data: Buffer; mime: string } | undefined> {
    const clean = speakable(text);
    if (!clean) return undefined;
    const cached = this.cache.get(clean);
    if (cached) return cached;
    let audio: { data: Buffer; mime: string } | undefined;
    if (this.local?.active()) {
      const wav = await this.local.synthesize(clean).catch(() => undefined);
      if (wav) return { data: wav, mime: "audio/wav" };
    }
    if (Date.now() >= this.offlineUntil) {
      try {
        audio = { data: await this.edge(clean), mime: "audio/mpeg" };
        this.failures = 0;
      } catch (error) {
        this.tts = undefined;
        this.failures += 1;
        this.lastError = error instanceof Error ? error.message : String(error);
        this.offlineUntil = Date.now() + 5 * 60_000;
      }
    }
    audio ??= await this.windows(clean).catch(() => undefined);
    // Les phrases courtes reviennent souvent (« Je t'écoute. », annonces de pages) : on les garde.
    if (audio && clean.length <= 60 && audio.mime === "audio/mpeg") {
      this.cache.set(clean, audio);
      if (this.cache.size > 80) this.cache.delete(this.cache.keys().next().value!);
    }
    return audio;
  }

  private async edge(text: string): Promise<Buffer> {
    if (!this.tts) {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(this.voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      this.tts = tts;
    }
    const { audioStream } = this.tts.toStream(text, { rate: this.rate, pitch: this.pitch });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("délai dépassé")), 15_000);
      audioStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      audioStream.on("end", () => {
        clearTimeout(timer);
        resolve();
      });
      audioStream.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    if (chunks.length === 0) throw new Error("audio vide");
    return Buffer.concat(chunks);
  }

  /** Voix de secours intégrée à Windows (moins naturelle, mais sans Internet). */
  private async windows(text: string): Promise<{ data: Buffer; mime: string }> {
    const dir = await mkdtemp(path.join(tmpdir(), "jarvis-voix-"));
    const file = path.join(dir, "phrase.wav");
    try {
      await runPowerShell(
        [
          "Add-Type -AssemblyName System.Speech",
          "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
          "$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'fr*' -and $_.VoiceInfo.Gender -eq 'Female' } | Select-Object -First 1",
          "if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }",
          `$s.SetOutputToWaveFile(${psString(file)}); $s.Speak(${psString(text)}); $s.Dispose()`,
        ].join("\n"),
        30_000,
      );
      return { data: await readFile(file), mime: "audio/wav" };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | Array<{ text: string }>>;

/** Reconnaissance vocale locale (Whisper). Le modèle se télécharge au premier lancement. */
export class Ears {
  private transcriber: Promise<Transcriber> | undefined;
  /** Appareil réellement utilisé (dml = carte graphique, cpu = processeur). */
  activeDevice: string | undefined;
  loadError: string | undefined;

  constructor(private readonly options: { cacheDir: string; model: string; device: string }) {}

  get model(): string {
    return this.options.model;
  }

  /** Change de modèle (avant le premier chargement). */
  configure(model: string, device?: string): void {
    if (this.transcriber) return;
    this.options.model = model;
    if (device) this.options.device = device;
  }

  private load(): Promise<Transcriber> {
    if (!this.transcriber) {
      this.transcriber = (async () => {
        const { pipeline, env } = await import("@huggingface/transformers");
        env.cacheDir = this.options.cacheDir;
        const create = (device: string) =>
          pipeline("automatic-speech-recognition", this.options.model, { device: device as "cpu", dtype: "q8" }) as unknown as Promise<Transcriber>;
        try {
          const t = await create(this.options.device);
          this.activeDevice = this.options.device;
          return t;
        } catch (error) {
          if (this.options.device === "cpu") throw error;
          console.warn(`[oreilles] ${this.options.device} indisponible, passage sur le processeur`, error);
          const t = await create("cpu");
          this.activeDevice = "cpu";
          return t;
        }
      })();
      this.transcriber.catch((error) => {
        this.loadError = error instanceof Error ? error.message : String(error);
        this.transcriber = undefined;
      });
    }
    return this.transcriber;
  }

  /** Préchargement au démarrage pour que la première phrase soit rapide. */
  warmUp(): void {
    void this.load().catch((error) => console.error("[oreilles] modèle non chargé", error));
  }

  async transcribe(audio16k: Float32Array): Promise<string> {
    const transcriber = await this.load();
    const output = await transcriber(audio16k, { language: "french", task: "transcribe", chunk_length_s: 30 });
    const text = Array.isArray(output) ? output.map((o) => o.text).join(" ") : output.text;
    return cleanTranscript(text);
  }
}

/** Modèle de reconnaissance selon la carte graphique : Whisper large-v3-turbo avec 6 Go de mémoire vidéo ou plus, sinon small. */
export function pickSpeechModel(vramMb: number | undefined): { model: string; device: string } {
  if (vramMb !== undefined && vramMb >= 6000) return { model: "onnx-community/whisper-large-v3-turbo", device: "dml" };
  if (vramMb !== undefined && vramMb >= 2500) return { model: "onnx-community/whisper-small", device: "dml" };
  return { model: "onnx-community/whisper-small", device: vramMb ? "dml" : "cpu" };
}

/** Pendant que Jarvis parle, seuls ces mots l'interrompent (sa propre voix ne doit pas le couper). */
export function isInterruption(transcript: string): boolean {
  return /\b(stop|arr[êe]te|attends|tais-toi|silence|jarvis)\b/i.test(transcript);
}

/** Whisper invente parfois des phrases sur du silence : on les écarte. */
export function cleanTranscript(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (/^(\[.*\]|\(.*\)|sous-titr|merci d'avoir regardé|abonnez-vous|musique|\.+)$/i.test(t) || /sous-titrage|amara\.org/i.test(t)) return "";
  return t;
}
