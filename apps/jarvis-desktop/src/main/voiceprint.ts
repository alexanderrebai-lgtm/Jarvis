import { JsonStore } from "@muscu/jarvis/src/store.js";

/**
 * Verrou vocal : Jarvis apprend l'empreinte de la voix d'Alex (cinq phrases),
 * puis compare chaque phrase entendue. Une voix inconnue (télé, invité) peut
 * poser des questions mais pas agir. Le calcul se fait sur le PC (modèle
 * WavLM), rien n'est envoyé ailleurs.
 */

export interface SpeakerEmbedder {
  embed: (audio16k: Float32Array) => Promise<Float32Array>;
}

interface VoiceprintState {
  modele: string;
  empreintes: number[][];
  moyenne?: number[];
  seuil: number;
  creeLe?: string;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function mean(vectors: number[][]): number[] {
  const out = new Array<number>(vectors[0]?.length ?? 0).fill(0);
  for (const v of vectors) v.forEach((x, i) => (out[i] = out[i]! + x / vectors.length));
  return out;
}

export const ENROLL_PHRASES = [
  "Jarvis, voici ma voix pour que tu la reconnaisses.",
  "Le Mans Ultimate, vingt-quatre heures, relais de nuit sous la pluie.",
  "Rappelle-moi le planning de l'équipe pour lundi matin.",
  "Allume la lumière du salon et mets un peu de musique.",
  "Ouvre la page de recherche et développement sur l'écran de gauche.",
];

export class VoiceLock {
  private readonly store: JsonStore<VoiceprintState>;
  private enrolling: number[][] | undefined;

  constructor(dataDir: string, private readonly embedder: SpeakerEmbedder, private readonly modelName: string, defaultThreshold = 0.86) {
    this.store = new JsonStore(dataDir, "voix", () => ({ modele: modelName, empreintes: [], seuil: defaultThreshold }));
  }

  get enrolled(): boolean {
    const s = this.store.read();
    return s.modele === this.modelName && s.empreintes.length >= 3;
  }

  get isEnrolling(): boolean {
    return this.enrolling !== undefined;
  }

  get threshold(): number {
    return this.store.read().seuil;
  }

  setThreshold(value: number): void {
    this.store.update((s) => ({ ...s, seuil: Math.min(0.98, Math.max(0.5, value)) }));
  }

  /** Commence l'apprentissage : les cinq phrases suivantes servent d'empreinte. */
  startEnrollment(): string[] {
    this.enrolling = [];
    return ENROLL_PHRASES;
  }

  cancelEnrollment(): void {
    this.enrolling = undefined;
  }

  /** Ajoute une phrase à l'apprentissage. Renvoie combien il en reste. */
  async addEnrollmentSample(audio16k: Float32Array): Promise<number> {
    if (!this.enrolling) throw new Error("L'apprentissage de la voix n'est pas commencé.");
    if (audio16k.length < 16_000 * 1.2) return ENROLL_PHRASES.length - this.enrolling.length;
    this.enrolling.push([...(await this.embedder.embed(audio16k))]);
    const left = ENROLL_PHRASES.length - this.enrolling.length;
    if (left <= 0) {
      const empreintes = this.enrolling;
      this.enrolling = undefined;
      this.store.update((s) => ({ ...s, modele: this.modelName, empreintes, moyenne: mean(empreintes), creeLe: new Date().toISOString() }));
    }
    return Math.max(0, left);
  }

  forget(): void {
    this.enrolling = undefined;
    this.store.update((s) => ({ ...s, empreintes: [], moyenne: undefined }));
  }

  /**
   * Compare une phrase à l'empreinte. Sans empreinte, tout le monde est accepté
   * (le diagnostic le signale). Les phrases très courtes ne sont pas jugeables :
   * elles comptent comme « inconnues » pour les actions sensibles seulement.
   */
  async verify(audio16k: Float32Array): Promise<{ owner: boolean; score: number | undefined; reason: string }> {
    const s = this.store.read();
    if (!this.enrolled) return { owner: true, score: undefined, reason: "pas d'empreinte" };
    if (audio16k.length < 16_000 * 0.8) return { owner: false, score: undefined, reason: "phrase trop courte" };
    const e = await this.embedder.embed(audio16k);
    const scores = [cosine(e, s.moyenne ?? mean(s.empreintes)), ...s.empreintes.map((v) => cosine(e, v))];
    const score = Math.max(...scores);
    return { owner: score >= s.seuil, score, reason: score >= s.seuil ? "voix reconnue" : "voix différente" };
  }
}

/** Empreinte vocale par WavLM (transformers.js, sur le PC). */
export function wavlmEmbedder(options: { cacheDir: string; model?: string; device?: string }): SpeakerEmbedder {
  const modelId = options.model ?? "Xenova/wavlm-base-plus-sv";
  let loaded: Promise<{ processor: (audio: Float32Array) => Promise<unknown>; model: (inputs: unknown) => Promise<{ embeddings: { data: Float32Array } }> }> | undefined;
  const load = () => {
    loaded ??= (async () => {
      const transformers = (await import("@huggingface/transformers")) as unknown as {
        env: { cacheDir: string };
        AutoProcessor: { from_pretrained: (id: string) => Promise<(audio: Float32Array) => Promise<unknown>> };
        WavLMForXVector: { from_pretrained: (id: string, o?: unknown) => Promise<(inputs: unknown) => Promise<{ embeddings: { data: Float32Array } }>> };
      };
      transformers.env.cacheDir = options.cacheDir;
      const processor = await transformers.AutoProcessor.from_pretrained(modelId);
      const model = await transformers.WavLMForXVector.from_pretrained(modelId, { dtype: "fp32", device: "cpu" });
      return { processor, model };
    })();
    loaded.catch(() => (loaded = undefined));
    return loaded;
  };
  return {
    embed: async (audio) => {
      const { processor, model } = await load();
      const inputs = await processor(audio);
      const { embeddings } = await model(inputs);
      return Float32Array.from(embeddings.data);
    },
  };
}
