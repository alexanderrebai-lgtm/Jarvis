/**
 * Analyse du micro, en JavaScript pur (testable) :
 * - détection de la voix (début et fin d'une phrase) ;
 * - détection d'un double claquement de mains.
 * Le son arrive par blocs (par exemple 512 échantillons à 16 kHz, soit 32 ms).
 */

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i]! * frame[i]!;
  return Math.sqrt(sum / Math.max(1, frame.length));
}

/** Part d'énergie dans les aigus : un claquement est très aigu, la voix beaucoup moins. */
export function highFrequencyRatio(frame: Float32Array): number {
  let diff = 0;
  let total = 0;
  for (let i = 1; i < frame.length; i += 1) {
    const d = frame[i]! - frame[i - 1]!;
    diff += d * d;
    total += frame[i]! * frame[i]!;
  }
  return total === 0 ? 0 : diff / (4 * total);
}

export interface VadOptions {
  sampleRate: number;
  /** Énergie minimale au-dessus du bruit de fond pour considérer que quelqu'un parle. */
  threshold?: number;
  /** Silence qui termine une phrase. */
  silenceMs?: number;
  minSpeechMs?: number;
  maxSpeechMs?: number;
}

/** Découpe le flux du micro en phrases, en s'adaptant au bruit de fond de la pièce. */
export class VoiceActivityDetector {
  private noise = 0.005;
  private speaking = false;
  private buffer: Float32Array[] = [];
  private speechMs = 0;
  private silenceMs = 0;
  private readonly options: Required<VadOptions>;

  constructor(options: VadOptions) {
    this.options = { threshold: 2.8, silenceMs: 800, minSpeechMs: 350, maxSpeechMs: 20_000, ...options };
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Renvoie une phrase complète quand elle se termine, sinon undefined. */
  push(frame: Float32Array): Float32Array | undefined {
    const level = rms(frame);
    const frameMs = (frame.length / this.options.sampleRate) * 1000;
    const loud = level > Math.max(0.01, this.noise * this.options.threshold);

    if (!this.speaking) {
      // Le bruit de fond suit lentement le niveau quand personne ne parle.
      this.noise = this.noise * 0.95 + level * 0.05;
      if (loud) {
        this.speaking = true;
        this.buffer = [frame];
        this.speechMs = frameMs;
        this.silenceMs = 0;
      }
      return undefined;
    }

    this.buffer.push(frame);
    this.speechMs += frameMs;
    this.silenceMs = loud ? 0 : this.silenceMs + frameMs;
    if (this.silenceMs >= this.options.silenceMs || this.speechMs >= this.options.maxSpeechMs) {
      this.speaking = false;
      const voiced = this.speechMs - this.silenceMs;
      const chunks = this.buffer;
      this.buffer = [];
      if (voiced < this.options.minSpeechMs) return undefined;
      const length = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Float32Array(length);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
      }
      return out;
    }
    return undefined;
  }
}

export interface ClapOptions {
  sampleRate: number;
  /** Écart maximal entre deux claquements d'un même double claquement. */
  maxGapMs?: number;
  minGapMs?: number;
}

/**
 * Double claquement : deux pics brefs, forts et aigus, espacés de 0,15 à 0,8 s,
 * sur un fond calme. Un seul claquement, une porte qui claque ou la voix ne
 * déclenchent rien.
 */
export class ClapDetector {
  private background = 0.01;
  private lastClapAt = -Infinity;
  private elapsedMs = 0;
  private loudFrames = 0;
  private readonly options: Required<ClapOptions>;

  constructor(options: ClapOptions) {
    this.options = { maxGapMs: 800, minGapMs: 150, ...options };
  }

  /** Renvoie true au moment où un double claquement est reconnu. */
  push(frame: Float32Array): boolean {
    const frameMs = (frame.length / this.options.sampleRate) * 1000;
    this.elapsedMs += frameMs;
    const level = rms(frame);
    let peak = 0;
    for (let i = 0; i < frame.length; i += 1) peak = Math.max(peak, Math.abs(frame[i]!));

    const impulsive = peak > 0.3 && level > this.background * 6 && peak / Math.max(level, 1e-6) > 4 && highFrequencyRatio(frame) > 0.25;
    if (!impulsive) {
      this.loudFrames = level > this.background * 3 ? this.loudFrames + 1 : 0;
      this.background = this.background * 0.98 + Math.min(level, 0.2) * 0.02;
      return false;
    }
    // Un bruit fort qui dure (musique, voix forte) n'est pas un claquement.
    if (this.loudFrames > 3) return false;

    const gap = this.elapsedMs - this.lastClapAt;
    if (gap < this.options.minGapMs) return false; // même claquement, bloc suivant
    if (gap <= this.options.maxGapMs) {
      this.lastClapAt = -Infinity;
      return true;
    }
    this.lastClapAt = this.elapsedMs;
    return false;
  }
}

/** Ramène un son à 16 kHz (fréquence attendue par Whisper). */
export function resample(input: Float32Array, fromRate: number, toRate = 16_000): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j]!;
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}
