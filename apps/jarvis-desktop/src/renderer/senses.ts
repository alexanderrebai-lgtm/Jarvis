import { FilesetResolver, GestureRecognizer, ObjectDetector } from "@mediapipe/tasks-vision";
import { ClapDetector, resample, VoiceActivityDetector } from "../shared/audio.js";
import { PalmTracker } from "../shared/gestures.js";
import { api, setCoreLevel } from "./common.js";

/**
 * Les sens de Jarvis, portés par la fenêtre d'accueil (toujours ouverte) :
 * micro (voix et claquements), voix de Jarvis, webcams et gestes.
 */

export const flags = { micro: true, cameras: true, doNotDisturb: false };
const sensesState = { micro: false, cameras: 0, gestes: false, detecteur: false };
function reportSenses(change: Partial<typeof sensesState>): void {
  Object.assign(sensesState, change);
  api.send("senses:etat", sensesState);
}
let listening = false;
api.on("jarvis:state", ({ state }: { state: string }) => (listening = state === "ecoute"));
api.on("jarvis:flags", (next: typeof flags) => {
  const camerasChanged = next.cameras !== flags.cameras;
  Object.assign(flags, next);
  if (camerasChanged) {
    if (flags.cameras) void startWebcams();
    else stopWebcams();
  }
});

// ---------- Voix de Jarvis ----------

const queue: Array<{ data: string; mime: string; radio?: boolean }> = [];
let playing: HTMLAudioElement | undefined;
let context: AudioContext | undefined;

function chirp(ctx: AudioContext): Promise<void> {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(1400, ctx.currentTime);
  osc.frequency.setValueAtTime(1050, ctx.currentTime + 0.07);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.17);
  return new Promise((resolve) => setTimeout(resolve, 190));
}

function playNext(): void {
  if (playing) return;
  const item = queue.shift();
  if (!item) {
    api.send("audio:speaking", false);
    return;
  }
  const audio = new Audio(`data:${item.mime};base64,${item.data}`);
  playing = audio;
  api.send("audio:speaking", true);
  context ??= new AudioContext();
  const ctx = context;
  const source = ctx.createMediaElementSource(audio);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  analyser.connect(ctx.destination);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const meter = () => {
    if (playing !== audio) return;
    analyser.getByteFrequencyData(data);
    setCoreLevel((data.reduce((a, b) => a + b, 0) / data.length / 255) * 2.2);
    requestAnimationFrame(meter);
  };
  meter();
  const done = () => {
    if (playing === audio) playing = undefined;
    setCoreLevel(0);
    playNext();
  };
  audio.onended = done;
  audio.onerror = done;
  const start = () => void audio.play().catch(done);
  if (item.radio) void chirp(ctx).then(start);
  else start();
}

api.on("audio:play", (item) => {
  queue.push(item);
  playNext();
});
api.on("audio:stop", () => {
  queue.length = 0;
  playing?.pause();
  playing = undefined;
  setCoreLevel(0);
  api.send("audio:speaking", false);
});

// ---------- Micro ----------

export async function startMicrophone(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(2048, 1, 1);
  const vad = new VoiceActivityDetector({ sampleRate: 16_000 });
  const claps = new ClapDetector({ sampleRate: ctx.sampleRate });
  source.connect(processor);
  processor.connect(ctx.destination);
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    event.outputBuffer.getChannelData(0).fill(0);
    if (!flags.micro) return;
    // Pendant que Jarvis parle, on écoute quand même (l'écho est filtré) : seuls « stop » ou « Jarvis… » l'interrompront.
    if (!playing && claps.push(input)) api.send("audio:clap");
    const frame = resample(input, ctx.sampleRate);
    if (listening) {
      let peak = 0;
      for (let i = 0; i < frame.length; i += 1) peak = Math.max(peak, Math.abs(frame[i]!));
      setCoreLevel(peak * 2);
    }
    const utterance = vad.push(frame);
    if (utterance) api.send("audio:utterance", { samples: utterance, pendantParole: Boolean(playing) });
  };
  reportSenses({ micro: true });
}

// ---------- Sonnerie (réveil sans Spotify, fin de minuteur) ----------

let ringing: { stop: () => void } | undefined;

function startRing(short: boolean): void {
  ringing?.stop();
  context ??= new AudioContext();
  const ctx = context;
  const master = ctx.createGain();
  master.gain.value = short ? 0.25 : 0.06;
  master.connect(ctx.destination);
  const notes = [659.25, 783.99, 987.77, 1318.5];
  let n = 0;
  let stopped = false;
  const chime = () => {
    if (stopped) return;
    // Arpège doux, de plus en plus fort (réveil), ou trois notes (minuteur).
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      const t0 = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.9, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      osc.connect(g).connect(master);
      osc.start(t0);
      osc.stop(t0 + 1);
    });
    n += 1;
    if (!short) master.gain.value = Math.min(0.55, 0.06 + n * 0.02);
    if (short && n >= 3) return stop();
    timer = setTimeout(chime, short ? 1100 : 2600);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    master.disconnect();
    if (ringing?.stop === stop) ringing = undefined;
  };
  ringing = { stop };
  chime();
}

api.on("audio:ring", ({ on, court }: { on: boolean; court?: boolean }) => {
  if (on) startRing(court === true);
  else ringing?.stop();
});

// ---------- Vérification « est-ce une personne ? » (surveillance complète) ----------

let detector: Promise<ObjectDetector | undefined> | undefined;
function loadDetector(): Promise<ObjectDetector | undefined> {
  detector ??= (async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks("./wasm");
      const d = await ObjectDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite", delegate: "CPU" },
        scoreThreshold: 0.45,
        maxResults: 5,
        categoryAllowlist: ["person"],
        runningMode: "IMAGE",
      });
      reportSenses({ detecteur: true });
      return d;
    } catch (error) {
      console.warn("Détecteur de personnes indisponible", error);
      detector = undefined;
      return undefined;
    }
  })();
  return detector;
}

api.on("securite:verifier", async ({ id, jpegBase64 }: { id: string; jpegBase64: string }) => {
  try {
    const d = await loadDetector();
    if (!d) return api.send("securite:verdict", { id });
    const blob = await (await fetch(`data:image/jpeg;base64,${jpegBase64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const result = d.detect(bitmap);
    bitmap.close();
    api.send("securite:verdict", { id, personne: result.detections.some((x) => x.categories.some((c) => c.categoryName === "person" && c.score >= 0.45)) });
  } catch {
    api.send("securite:verdict", { id });
  }
});

// ---------- Webcams et gestes ----------

const videos: HTMLVideoElement[] = [];
const holder = document.createElement("div");
holder.style.cssText = "position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
document.body.append(holder);
let gestureListener: ((gesture: string, wrist?: { x: number; y: number }) => void) | undefined;

/** Les gestes sont aussi transmis à la page (pour faire tourner un modèle 3D au poing). */
export function onGesture(listener: (gesture: string, wrist?: { x: number; y: number }) => void): void {
  gestureListener = listener;
}

export async function startWebcams(): Promise<number> {
  stopWebcams();
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  for (const device of devices.slice(0, 6)) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: device.deviceId }, width: 1280, height: 720 } });
      const video = document.createElement("video");
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.srcObject = stream;
      video.title = device.label || `Caméra ${videos.length + 1}`;
      holder.append(video);
      videos.push(video);
    } catch (error) {
      console.warn("Caméra indisponible", device.label, error);
    }
  }
  if (videos[0]) void startGestures(videos[0]);
  reportSenses({ cameras: videos.length });
  return videos.length;
}

function stopWebcams(): void {
  for (const video of videos) (video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
  videos.length = 0;
  holder.replaceChildren();
}

function frame(video: HTMLVideoElement, maxWidth = 1280): string {
  const ratio = Math.min(1, maxWidth / Math.max(1, video.videoWidth));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * ratio);
  canvas.height = Math.round(video.videoHeight * ratio);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8).split(",")[1]!;
}

api.on("camera:capture", ({ id, index }: { id: string; index?: number }) => {
  const chosen = index === undefined ? videos : videos.filter((_, i) => i === index);
  api.send("camera:frames", { id, frames: chosen.filter((v) => v.videoWidth > 0).map((v) => ({ nom: v.title, jpegBase64: frame(v) })) });
});

async function startGestures(video: HTMLVideoElement): Promise<void> {
  try {
    const vision = await FilesetResolver.forVisionTasks("./wasm");
    const recognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task", delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 1,
    });
    let candidate = "";
    let since = 0;
    let lastSent = 0;
    const palm = new PalmTracker();
    reportSenses({ gestes: true });
    const loop = () => {
      if (!videos.includes(video)) return;
      if (video.readyState >= 2) {
        const now = performance.now();
        const result = recognizer.recognizeForVideo(video, now);
        const top = result.gestures[0]?.[0];
        const name = top && top.score > 0.7 ? top.categoryName : "";
        const wrist = result.landmarks[0]?.[0];
        if (name === "Closed_Fist" && wrist) gestureListener?.(name, { x: wrist.x, y: wrist.y });
        // Main ouverte : immobile = stop, balayée = changer les pages d'écran.
        const palmEvent = palm.push(name === "Open_Palm" && Boolean(wrist), wrist?.x ?? 0, wrist?.y ?? 0, now);
        if (palmEvent) api.send("gesture", palmEvent === "stop" ? "Palm_Stop" : palmEvent === "balayage-droite" ? "Swipe_Droite" : "Swipe_Gauche");
        if (name !== candidate) {
          candidate = name;
          since = now;
        } else if (name && name !== "None" && name !== "Closed_Fist" && name !== "Open_Palm" && now - since > 600 && now - lastSent > 2500) {
          lastSent = now;
          api.send("gesture", name);
          gestureListener?.(name);
        }
      }
      setTimeout(loop, 90);
    };
    loop();
  } catch (error) {
    console.warn("Gestes indisponibles", error);
  }
}

// ---------- Bouton « parler » du volant ----------

export function watchWheel(getButton: () => number | null, onUnknown: (index: number) => void): void {
  const pressed = new Set<string>();
  setInterval(() => {
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      pad.buttons.forEach((button, index) => {
        const key = `${pad.index}:${index}`;
        if (button.pressed && !pressed.has(key)) {
          pressed.add(key);
          if (getButton() === index) api.send("jarvis:listen");
          else if (getButton() === null) onUnknown(index);
        } else if (!button.pressed) pressed.delete(key);
      });
    }
  }, 40);
}

// Le détecteur de personnes se prépare dès que la surveillance complète est activée.
api.on("jarvis:flags", (f: { surveillance?: string }) => {
  if (f.surveillance === "complete") void loadDetector();
});
