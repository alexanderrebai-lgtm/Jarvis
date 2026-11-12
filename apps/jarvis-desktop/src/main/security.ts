import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";

/**
 * Sécurité : caméras Tapo lues en local (flux RTSP du « compte de la caméra »),
 * converties par ffmpeg en images JPEG pour l'interface, avec détection de
 * mouvement. Rien ne sort du réseau de la maison.
 */

export interface CameraConfig {
  nom: string;
  ip: string;
}

export interface SecurityEvent {
  camera: string;
  instant: string;
  intensitePct: number;
  image?: string;
  /** Vidéo enregistrée (surveillance complète). */
  video?: string;
  /** Personne vue sur l'image (si la vérification a pu se faire). */
  personne?: boolean;
}

/** off : rien n'est annoncé ; simple : annonce et notification ; complete : en plus vidéo, alerte téléphone, dissuasion. */
export type SurveillanceMode = "off" | "simple" | "complete";

/** « Entrée=192.168.1.30,Jardin=192.168.1.31 » → liste de caméras. */
export function parseCameras(raw: string | undefined): CameraConfig[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [nom, ip] = part.split("=").map((s) => s.trim());
      if (!nom || !ip || !/^[\w.-]+$/.test(ip)) throw new Error(`TAPO_CAMERAS mal écrit près de « ${part} » (attendu Nom=IP).`);
      return { nom, ip };
    });
}

export function rtspUrl(camera: CameraConfig, user: string, password: string, quality: "haute" | "basse"): string {
  return `rtsp://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${camera.ip}:554/${quality === "haute" ? "stream1" : "stream2"}`;
}

/** Découpe un flux MJPEG (images JPEG collées les unes aux autres). */
export class JpegSplitter {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): Buffer[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Buffer[] = [];
    for (;;) {
      const start = this.buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (start === -1) {
        this.buffer = Buffer.alloc(0);
        break;
      }
      const end = this.buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (end === -1) {
        this.buffer = this.buffer.subarray(start);
        break;
      }
      frames.push(this.buffer.subarray(start, end + 2));
      this.buffer = this.buffer.subarray(end + 2);
    }
    if (this.buffer.length > 8_000_000) this.buffer = Buffer.alloc(0);
    return frames;
  }
}

/**
 * Détection de mouvement sur des images en niveaux de gris très réduites
 * (64×36) : on compare à un fond qui s'adapte lentement (lumière, nuages).
 */
export class MotionDetector {
  private background: Float32Array | undefined;
  private streak = 0;
  private lastEventAt = -Infinity;

  constructor(private readonly options: { threshold?: number; minChangedPct?: number; cooldownMs?: number; now?: () => number } = {}) {}

  /** Renvoie le pourcentage de l'image qui a bougé quand un mouvement est confirmé, sinon undefined. */
  push(gray: Uint8Array): number | undefined {
    const threshold = this.options.threshold ?? 28;
    const minChanged = this.options.minChangedPct ?? 3;
    const now = this.options.now?.() ?? Date.now();
    if (!this.background || this.background.length !== gray.length) {
      this.background = Float32Array.from(gray);
      return undefined;
    }
    let changed = 0;
    for (let i = 0; i < gray.length; i += 1) {
      const diff = Math.abs(gray[i]! - this.background[i]!);
      if (diff > threshold) changed += 1;
      // Le fond suit lentement la scène, plus vite là où rien ne bouge.
      this.background[i] = this.background[i]! + (gray[i]! - this.background[i]!) * (diff > threshold ? 0.02 : 0.1);
    }
    const pct = (changed / gray.length) * 100;
    // Une image où presque tout change d'un coup = changement de lumière (lampe, IR), pas un intrus.
    if (pct >= minChanged && pct < 85) this.streak += 1;
    else this.streak = 0;
    if (this.streak >= 2 && now - this.lastEventAt > (this.options.cooldownMs ?? 60_000)) {
      this.lastEventAt = now;
      this.streak = 0;
      return Math.round(pct);
    }
    return undefined;
  }
}

interface CameraRuntime {
  config: CameraConfig;
  process?: ChildProcess;
  latest?: Buffer;
  lastFrameAt: number;
  restarts: number;
  motion: MotionDetector;
  listeners: Set<(frame: Buffer) => void>;
}

export interface SecurityOptions {
  cameras: CameraConfig[];
  user: string;
  password: string;
  ffmpegPath: string | undefined;
  folder: string;
  onEvent: (event: SecurityEvent, mode: SurveillanceMode) => void;
}

export class SecurityService {
  private readonly runtimes: CameraRuntime[];
  private server: Server | undefined;
  private port = 0;
  private readonly token = randomBytes(12).toString("hex");
  private stopped = false;
  mode: SurveillanceMode = "off";
  readonly events: SecurityEvent[] = [];

  get armed(): boolean {
    return this.mode !== "off";
  }

  set armed(value: boolean) {
    this.mode = value ? (this.mode === "off" ? "simple" : this.mode) : "off";
  }

  constructor(private readonly options: SecurityOptions) {
    this.runtimes = options.cameras.map((config) => ({ config, lastFrameAt: 0, restarts: 0, motion: new MotionDetector(), listeners: new Set() }));
  }

  get enabled(): boolean {
    return this.runtimes.length > 0 && Boolean(this.options.ffmpegPath);
  }

  /** Adresses locales des flux vidéo, pour l'interface. */
  streams(): Array<{ nom: string; url: string; enDirect: boolean }> {
    return this.runtimes.map((r, i) => ({ nom: r.config.nom, url: `http://127.0.0.1:${this.port}/camera/${i}?t=${this.token}`, enDirect: Date.now() - r.lastFrameAt < 5_000 }));
  }

  latestFrame(index: number): Buffer | undefined {
    return this.runtimes[index]?.latest;
  }

  cameraNames(): string[] {
    return this.runtimes.map((r) => r.config.nom);
  }

  async start(): Promise<void> {
    if (!this.enabled) return;
    await this.listen();
    this.runtimes.forEach((r) => this.launch(r));
  }

  stop(): void {
    this.stopped = true;
    for (const r of this.runtimes) r.process?.kill();
    this.server?.close();
  }

  /** Serveur local qui diffuse chaque caméra en MJPEG (lisible par une simple balise <img>). */
  private listen(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const match = url.pathname.match(/^\/camera\/(\d+)$/);
        const runtime = match ? this.runtimes[Number(match[1])] : undefined;
        if (!runtime || url.searchParams.get("t") !== this.token) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { "content-type": "multipart/x-mixed-replace; boundary=jarvis", "cache-control": "no-store", connection: "close" });
        const send = (frame: Buffer) => {
          res.write(`--jarvis\r\ncontent-type: image/jpeg\r\ncontent-length: ${frame.length}\r\n\r\n`);
          res.write(frame);
          res.write("\r\n");
        };
        if (runtime.latest) send(runtime.latest);
        runtime.listeners.add(send);
        req.on("close", () => runtime.listeners.delete(send));
      });
      this.server.listen(0, "127.0.0.1", () => {
        const address = this.server!.address();
        this.port = typeof address === "object" && address ? address.port : 0;
        resolve();
      });
    });
  }

  private launch(runtime: CameraRuntime): void {
    if (this.stopped || !this.options.ffmpegPath) return;
    const input = rtspUrl(runtime.config, this.options.user, this.options.password, "basse");
    // Deux sorties : des JPEG pour l'affichage (5 images/s) et de minuscules images grises pour le mouvement (2/s).
    const args = [
      "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-i", input, "-an",
      "-filter_complex", "[0:v]split=2[a][b];[a]fps=5,scale=640:-2[view];[b]fps=2,scale=64:36,format=gray[motion]",
      "-map", "[view]", "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "6", "pipe:1",
      "-map", "[motion]", "-f", "rawvideo", "pipe:3",
    ];
    const child = spawn(this.options.ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe", "pipe"], windowsHide: true });
    runtime.process = child;
    const splitter = new JpegSplitter();
    child.stdout!.on("data", (chunk: Buffer) => {
      for (const frame of splitter.push(chunk)) {
        runtime.latest = frame;
        runtime.lastFrameAt = Date.now();
        runtime.restarts = 0;
        for (const listener of runtime.listeners) listener(frame);
      }
    });
    let pending = Buffer.alloc(0);
    const motionStream = child.stdio[3] as NodeJS.ReadableStream;
    motionStream.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 64 * 36) {
        const frame = pending.subarray(0, 64 * 36);
        pending = pending.subarray(64 * 36);
        const pct = runtime.motion.push(frame);
        if (pct !== undefined) this.record(runtime, pct);
      }
    });
    child.on("exit", () => {
      if (this.stopped) return;
      // Caméra injoignable ou coupure réseau : on réessaie, de plus en plus espacé (max 1 min).
      runtime.restarts += 1;
      setTimeout(() => this.launch(runtime), Math.min(60_000, 2_000 * runtime.restarts));
    });
  }

  private record(runtime: CameraRuntime, pct: number): void {
    const instant = new Date();
    let image: string | undefined;
    if (runtime.latest) {
      const dir = path.join(this.options.folder, instant.toISOString().slice(0, 10));
      mkdirSync(dir, { recursive: true });
      image = path.join(dir, `${instant.toISOString().slice(11, 19).replace(/:/g, "-")}_${runtime.config.nom.replace(/[^\p{L}\p{N}]+/gu, "-")}.jpg`);
      writeFileSync(image, runtime.latest);
    }
    const event: SecurityEvent = { camera: runtime.config.nom, instant: instant.toISOString(), intensitePct: pct, ...(image ? { image } : {}) };
    this.events.unshift(event);
    this.events.length = Math.min(this.events.length, 200);
    this.options.onEvent(event, this.mode);
  }

  /** Complète un évènement (vidéo, vérification de personne). */
  annotate(event: SecurityEvent, change: Partial<SecurityEvent>): void {
    Object.assign(event, change);
  }

  /** Enregistre quelques secondes de vidéo (flux haute qualité, copié sans réencodage). */
  recordClip(cameraName: string, seconds = 20): Promise<string | undefined> {
    const runtime = this.runtimes.find((r) => r.config.nom === cameraName);
    if (!runtime || !this.options.ffmpegPath) return Promise.resolve(undefined);
    const instant = new Date();
    const dir = path.join(this.options.folder, instant.toISOString().slice(0, 10));
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${instant.toISOString().slice(11, 19).replace(/:/g, "-")}_${runtime.config.nom.replace(/[^\p{L}\p{N}]+/gu, "-")}.mp4`);
    const args = ["-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-t", String(seconds), "-i", rtspUrl(runtime.config, this.options.user, this.options.password, "haute"), "-c:v", "copy", "-an", "-movflags", "+faststart", "-y", file];
    return new Promise((resolve) => {
      const child = spawn(this.options.ffmpegPath!, args, { stdio: "ignore", windowsHide: true });
      const timer = setTimeout(() => child.kill(), (seconds + 20) * 1000);
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code === 0 ? file : undefined);
      });
      child.on("error", () => resolve(undefined));
    });
  }
}
