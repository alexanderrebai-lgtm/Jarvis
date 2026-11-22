import path from "node:path";

/**
 * Mot d'éveil « Hey Jarvis » (modèles openWakeWord : mel-spectrogramme →
 * empreinte audio → score). Le micro arrive par blocs de 80 ms (1280
 * échantillons à 16 kHz) ; trois petits modèles tournent sur un seul cœur.
 * Tant que le mot n'est pas entendu, rien n'est transcrit : la grosse
 * reconnaissance vocale (Whisper) dort.
 *
 * Modèles : openWakeWord (code Apache 2.0 ; modèles pré-entraînés CC BY-NC-SA 4.0,
 * usage personnel non commercial).
 */

type Ort = typeof import("onnxruntime-node");
type Session = import("onnxruntime-node").InferenceSession;

const CHUNK = 1280; // 80 ms à 16 kHz
const MEL_CONTEXT = 160 * 3; // 3 trames de 10 ms en plus, comme openWakeWord
const MEL_WINDOW = 76; // trames de mel-spectrogramme par empreinte
const MEL_STEP = 8; // 80 ms = 8 trames de 10 ms
const FEATURES = 16; // empreintes par décision (1,28 s)
const MEL_BINS = 32;
const EMBEDDING = 96;

export interface WakeWordOptions {
  threshold?: number;
  /** Après une détection, on ignore le mot pendant ce délai (une seule détection par « Hey Jarvis »). */
  cooldownMs?: number;
  threads?: number;
}

export class WakeWordEngine {
  private raw = new Int16Array(0);
  private pending = new Int16Array(0);
  private mel: Float32Array[] = [];
  private features: Float32Array[] = [];
  private predictions = 0;
  private lastDetection = 0;
  private queue: Promise<void> = Promise.resolve();
  private backlog = 0;
  /** Dernier score (0 à 1), pour le diagnostic. */
  lastScore = 0;
  maxScore = 0;

  private constructor(
    private readonly ort: Ort,
    private readonly melModel: Session,
    private readonly embedModel: Session,
    private readonly wakeModel: Session,
    private readonly options: WakeWordOptions,
  ) {
    for (let i = 0; i < MEL_WINDOW; i++) this.mel.push(new Float32Array(MEL_BINS).fill(1));
  }

  static async load(dir: string, options: WakeWordOptions = {}): Promise<WakeWordEngine> {
    const ort = (await import("onnxruntime-node")) as Ort;
    const sessionOptions = { intraOpNumThreads: options.threads ?? 1, interOpNumThreads: 1, executionProviders: ["cpu"] };
    const [mel, embed, wake] = await Promise.all(
      ["melspectrogram.onnx", "embedding_model.onnx", "hey_jarvis_v0.1.onnx"].map((f) => ort.InferenceSession.create(path.join(dir, f), sessionOptions)),
    );
    const engine = new WakeWordEngine(ort, mel!, embed!, wake!, options);
    await engine.warmUp();
    return engine;
  }

  /** Remplit la mémoire des empreintes avec 4 s de bruit, comme openWakeWord au démarrage. */
  private async warmUp(): Promise<void> {
    const noise = new Int16Array(16_000 * 4);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.round(Math.random() * 2000 - 1000);
    const spec = await this.melspectrogram(noise);
    for (let i = 0; i + MEL_WINDOW <= spec.length; i += MEL_STEP) this.features.push(await this.embed(spec.slice(i, i + MEL_WINDOW)));
  }

  private async melspectrogram(samples: Int16Array): Promise<Float32Array[]> {
    const input = new this.ort.Tensor("float32", Float32Array.from(samples), [1, samples.length]);
    const out = await this.melModel.run({ [this.melModel.inputNames[0]!]: input });
    const tensor = out[this.melModel.outputNames[0]!]!;
    const data = tensor.data as Float32Array;
    const frames = data.length / MEL_BINS;
    const rows: Float32Array[] = [];
    for (let f = 0; f < frames; f++) {
      const row = new Float32Array(MEL_BINS);
      // Même transformation qu'openWakeWord : x / 10 + 2.
      for (let b = 0; b < MEL_BINS; b++) row[b] = data[f * MEL_BINS + b]! / 10 + 2;
      rows.push(row);
    }
    return rows;
  }

  private async embed(window: Float32Array[]): Promise<Float32Array> {
    const flat = new Float32Array(MEL_WINDOW * MEL_BINS);
    window.forEach((row, i) => flat.set(row, i * MEL_BINS));
    const input = new this.ort.Tensor("float32", flat, [1, MEL_WINDOW, MEL_BINS, 1]);
    const out = await this.embedModel.run({ [this.embedModel.inputNames[0]!]: input });
    return Float32Array.from((out[this.embedModel.outputNames[0]!]!.data as Float32Array).slice(0, EMBEDDING));
  }

  private async score(): Promise<number> {
    const last = this.features.slice(-FEATURES);
    const flat = new Float32Array(FEATURES * EMBEDDING);
    last.forEach((row, i) => flat.set(row, i * EMBEDDING));
    const input = new this.ort.Tensor("float32", flat, [1, FEATURES, EMBEDDING]);
    const out = await this.wakeModel.run({ [this.wakeModel.inputNames[0]!]: input });
    return (out[this.wakeModel.outputNames[0]!]!.data as Float32Array)[0] ?? 0;
  }

  /** Un bloc de 80 ms → score. */
  private async processChunk(chunk: Int16Array): Promise<number> {
    // Garde juste ce qu'il faut d'audio : le bloc + 30 ms de contexte.
    const raw = new Int16Array(Math.min(this.raw.length + chunk.length, CHUNK + MEL_CONTEXT));
    const merged = new Int16Array(this.raw.length + chunk.length);
    merged.set(this.raw);
    merged.set(chunk, this.raw.length);
    raw.set(merged.subarray(merged.length - raw.length));
    this.raw = raw;
    if (this.raw.length < 400) return 0;
    this.mel.push(...(await this.melspectrogram(this.raw)));
    if (this.mel.length > 970) this.mel = this.mel.slice(-970);
    if (this.mel.length >= MEL_WINDOW) {
      this.features.push(await this.embed(this.mel.slice(-MEL_WINDOW)));
      if (this.features.length > 120) this.features = this.features.slice(-120);
    }
    const s = await this.score();
    // Les toutes premières décisions ne comptent pas (mémoire pas encore remplie de vrai son).
    this.predictions += 1;
    return this.predictions <= 5 ? 0 : s;
  }

  /**
   * Ajoute du son (16 kHz, entiers 16 bits). Appelle onDetect quand « Hey Jarvis » est entendu.
   * Si le PC est trop chargé pour suivre, les blocs en retard sont abandonnés (jamais d'accumulation).
   */
  push(samples: Int16Array, onDetect: (score: number) => void): void {
    const all = new Int16Array(this.pending.length + samples.length);
    all.set(this.pending);
    all.set(samples, this.pending.length);
    let offset = 0;
    while (all.length - offset >= CHUNK) {
      const chunk = all.slice(offset, offset + CHUNK);
      offset += CHUNK;
      if (this.backlog > 6) continue;
      this.backlog += 1;
      this.queue = this.queue
        .then(async () => {
          const s = await this.processChunk(chunk);
          this.lastScore = s;
          this.maxScore = Math.max(this.maxScore, s);
          const now = Date.now();
          if (s >= (this.options.threshold ?? 0.5) && now - this.lastDetection > (this.options.cooldownMs ?? 2000)) {
            this.lastDetection = now;
            onDetect(s);
          }
        })
        .catch(() => undefined)
        .finally(() => (this.backlog -= 1));
    }
    this.pending = all.slice(offset);
  }

  set threshold(value: number) {
    this.options.threshold = value;
  }

  /** Attend la fin des calculs en cours (tests). */
  idle(): Promise<void> {
    return this.queue;
  }
}

/** Float32 (-1…1) → entiers 16 bits, comme un micro. */
export function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32767)));
  return out;
}
