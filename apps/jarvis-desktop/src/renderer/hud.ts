import { api, el, esc, voiceLevel } from "./common.js";

/**
 * Éléments du HUD : fond de pistes de circuit animées, réacteur Jarvis (SVG),
 * boutons ronds des pages, lignes de flux reliant Jarvis aux panneaux, jauges.
 */

// ---------- Fond : pistes de circuit, impulsions lumineuses, particules ----------

interface Trace { points: Array<[number, number]>; length: number }

export function startBackground(): void {
  const canvas = el("canvas");
  canvas.id = "bg";
  document.body.prepend(canvas);
  const g = canvas.getContext("2d")!;
  let traces: Trace[] = [];
  let staticLayer: HTMLCanvasElement | undefined;
  const particles = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.8 + 0.4, v: Math.random() * 0.00008 + 0.00002, p: Math.random() * Math.PI * 2, green: Math.random() < 0.25 }));
  const pulses: Array<{ trace: number; t: number; speed: number }> = [];
  const rgb = () => getComputedStyle(document.body).getPropertyValue("--hud-rgb").trim() || "60, 200, 255";

  const build = () => {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = innerWidth * ratio;
    canvas.height = innerHeight * ratio;
    const w = canvas.width;
    const h = canvas.height;
    traces = [];
    // Pistes horizontales avec des coudes à 45°, comme un circuit imprimé.
    for (let i = 0; i < 26; i += 1) {
      const fromLeft = i % 2 === 0;
      let x = fromLeft ? -20 : w + 20;
      let y = (0.08 + Math.random() * 0.84) * h;
      const pts: Array<[number, number]> = [[x, y]];
      const segments = 3 + Math.floor(Math.random() * 4);
      for (let s = 0; s < segments; s += 1) {
        const run = (0.05 + Math.random() * 0.16) * w;
        x += fromLeft ? run : -run;
        pts.push([x, y]);
        if (s < segments - 1) {
          const jog = (Math.random() - 0.5) * 0.12 * h;
          x += (fromLeft ? 1 : -1) * Math.abs(jog);
          y += jog;
          pts.push([x, y]);
        }
      }
      let length = 0;
      for (let p = 1; p < pts.length; p += 1) length += Math.hypot(pts[p]![0] - pts[p - 1]![0], pts[p]![1] - pts[p - 1]![1]);
      traces.push({ points: pts, length });
    }
    staticLayer = document.createElement("canvas");
    staticLayer.width = w;
    staticLayer.height = h;
    const s = staticLayer.getContext("2d")!;
    const c = rgb();
    for (const trace of traces) {
      s.strokeStyle = `rgba(${c}, 0.13)`;
      s.lineWidth = 1.2 * ratio;
      s.beginPath();
      trace.points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
      s.stroke();
      const [ex, ey] = trace.points.at(-1)!;
      s.fillStyle = `rgba(${c}, 0.45)`;
      s.beginPath();
      s.arc(ex, ey, 2.6 * ratio, 0, Math.PI * 2);
      s.fill();
    }
  };

  const pointAt = (trace: Trace, t: number): [number, number] => {
    let d = t * trace.length;
    for (let i = 1; i < trace.points.length; i += 1) {
      const [x0, y0] = trace.points[i - 1]!;
      const [x1, y1] = trace.points[i]!;
      const seg = Math.hypot(x1 - x0, y1 - y0);
      if (d <= seg) return [x0 + ((x1 - x0) * d) / seg, y0 + ((y1 - y0) * d) / seg];
      d -= seg;
    }
    return trace.points.at(-1)!;
  };

  let last = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    if (document.hidden || now - last < 33 || !staticLayer) return;
    last = now;
    const c = rgb();
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(staticLayer, 0, 0);
    if (pulses.length < 9 && Math.random() < 0.08) pulses.push({ trace: Math.floor(Math.random() * traces.length), t: 0, speed: 0.004 + Math.random() * 0.006 });
    for (let i = pulses.length - 1; i >= 0; i -= 1) {
      const pulse = pulses[i]!;
      pulse.t += pulse.speed;
      if (pulse.t >= 1) {
        pulses.splice(i, 1);
        continue;
      }
      const [x, y] = pointAt(traces[pulse.trace]!, pulse.t);
      const grad = g.createRadialGradient(x, y, 0, x, y, 14);
      grad.addColorStop(0, `rgba(${c}, 0.95)`);
      grad.addColorStop(1, `rgba(${c}, 0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, 14, 0, Math.PI * 2);
      g.fill();
    }
    for (const p of particles) {
      p.y -= p.v;
      if (p.y < 0) p.y = 1;
      p.p += 0.03;
      g.fillStyle = p.green ? `rgba(110, 255, 150, ${0.35 + Math.sin(p.p) * 0.3})` : `rgba(${c}, ${0.35 + Math.sin(p.p) * 0.3})`;
      g.beginPath();
      g.arc(p.x * canvas.width, p.y * canvas.height, p.r * (window.devicePixelRatio || 1), 0, Math.PI * 2);
      g.fill();
    }
  };
  build();
  addEventListener("resize", build);
  requestAnimationFrame(frame);
}

// ---------- Jarvis : la boule vivante et ses anneaux fins ----------

type OrbState = "veille" | "ecoute" | "reflexion" | "parole";

/** Couleurs de Jarvis : bleu à l'écoute, jaune quand il réfléchit, bleu clair quand il parle, rouge en surveillance complète. */
const ORB_COLORS: Record<OrbState | "surveillance", [number, number, number]> = {
  veille: [60, 170, 255],
  ecoute: [40, 150, 255],
  reflexion: [255, 196, 50],
  parole: [120, 220, 255],
  surveillance: [255, 52, 72],
};

let orbSurveillance = false;
api.on("jarvis:flags", (f: { surveillance?: string }) => (orbSurveillance = f.surveillance === "complete"));

function cssRgb(name: string): [number, number, number] | undefined {
  const raw = getComputedStyle(document.body).getPropertyValue(name).trim();
  const parts = raw.split(",").map((p) => Number(p.trim()));
  return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? (parts as [number, number, number]) : undefined;
}

/**
 * Le visage de Jarvis : une sphère de lumière vivante (plasma qui tourne,
 * surface qui ondule avec la voix) entourée de deux anneaux fins.
 * `size` peut être une fonction : la boule suit alors la taille de la fenêtre.
 */
export function createReactor(size: number | (() => number), label?: string): HTMLElement {
  const wrap = el("div", "reactor");
  const sizeOf = () => Math.round(typeof size === "function" ? size() : size);
  const canvas = el("canvas");
  wrap.append(canvas);
  wrap.insertAdjacentHTML(
    "beforeend",
    `<svg class="rings" viewBox="0 0 400 400"><g class="r1"><circle cx="200" cy="200" r="190" pathLength="100" stroke-dasharray="70 3 2 3 22"/><circle class="dot" cx="200" cy="10" r="3.2"/></g><g class="r2"><circle cx="200" cy="200" r="172" stroke-dasharray="1.2 6"/></g></svg>`,
  );
  const g = canvas.getContext("2d")!;
  let state: OrbState = "veille";
  let color: [number, number, number] = [...ORB_COLORS.veille];
  let level = 0;
  let spin = 1;
  const blobs = Array.from({ length: 7 }, (_, i) => ({ a: (i / 7) * Math.PI * 2, r: 0.28 + (i % 3) * 0.12, s: 0.25 + i * 0.07, size: 0.42 + (i % 2) * 0.16, w: 0.7 + (i % 4) * 0.2 }));
  const resize = () => {
    const px = sizeOf();
    wrap.style.setProperty("--size", `${px}px`);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(px * ratio);
    canvas.height = Math.round(px * ratio);
  };
  resize();
  if (typeof size === "function") addEventListener("resize", resize);

  let last = 0;
  let t = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    if (document.hidden || now - last < 33 || !wrap.isConnected) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // Cible de couleur : l'état, sinon le rouge de la surveillance, sinon la couleur de la page (orange en cockpit).
    const idle = orbSurveillance ? ORB_COLORS.surveillance : (cssRgb("--orb-idle") ?? ORB_COLORS.veille);
    const target = state === "veille" ? idle : ORB_COLORS[state];
    color = color.map((c, i) => c + (target[i]! - c) * Math.min(1, dt * 5)) as [number, number, number];
    level += (voiceLevel.value - level) * Math.min(1, dt * 14);
    const wantedSpin = state === "reflexion" ? 3.2 : state === "ecoute" ? 1.6 : state === "parole" ? 1.4 : 0.7;
    spin += (wantedSpin - spin) * Math.min(1, dt * 3);
    t += dt * spin;
    wrap.style.setProperty("--orb-rgb", color.map(Math.round).join(","));

    const w = canvas.width;
    const cx = w / 2;
    const R = w * 0.31;
    const [r, gg, b] = color.map(Math.round) as [number, number, number];
    g.clearRect(0, 0, w, w);

    // Halo extérieur.
    const halo = g.createRadialGradient(cx, cx, R * 0.6, cx, cx, R * 1.55);
    halo.addColorStop(0, `rgba(${r},${gg},${b},${0.32 + level * 0.3})`);
    halo.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = halo;
    g.fillRect(0, 0, w, w);

    // Contour qui ondule (plus fort quand quelqu'un parle).
    const wobble = (angle: number) => 1 + (0.018 + level * 0.07) * Math.sin(angle * 5 + t * 2.1) + (0.012 + level * 0.05) * Math.sin(angle * 9 - t * 3.3) + (state === "reflexion" ? 0.02 * Math.sin(angle * 3 + t * 5) : 0);
    g.save();
    g.beginPath();
    for (let i = 0; i <= 96; i += 1) {
      const a = (i / 96) * Math.PI * 2;
      const rr = R * wobble(a);
      if (i === 0) g.moveTo(cx + rr * Math.cos(a), cx + rr * Math.sin(a));
      else g.lineTo(cx + rr * Math.cos(a), cx + rr * Math.sin(a));
    }
    g.closePath();
    const body = g.createRadialGradient(cx - R * 0.25, cx - R * 0.3, R * 0.05, cx, cx, R * 1.05);
    body.addColorStop(0, `rgba(${Math.min(255, r + 120)},${Math.min(255, gg + 90)},${Math.min(255, b + 60)},0.95)`);
    body.addColorStop(0.45, `rgba(${r},${gg},${b},0.55)`);
    body.addColorStop(1, `rgba(${Math.round(r * 0.25)},${Math.round(gg * 0.25)},${Math.round(b * 0.35)},0.85)`);
    g.fillStyle = body;
    g.fill();
    g.clip();

    // Plasma : des nappes de lumière qui tournent à l'intérieur.
    g.globalCompositeOperation = "lighter";
    for (const blob of blobs) {
      const a = blob.a + t * blob.s;
      const x = cx + Math.cos(a) * R * blob.r * Math.cos(t * blob.w * 0.3);
      const y = cx + Math.sin(a * 1.3) * R * blob.r;
      const s2 = R * blob.size * (1 + level * 0.4);
      const grad = g.createRadialGradient(x, y, 0, x, y, s2);
      grad.addColorStop(0, `rgba(${Math.min(255, r + 80)},${Math.min(255, gg + 80)},${Math.min(255, b + 80)},${0.22 + level * 0.25})`);
      grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = grad;
      g.fillRect(x - s2, y - s2, s2 * 2, s2 * 2);
    }
    // Lignes d'énergie qui traversent la sphère.
    g.lineWidth = Math.max(1, w * 0.003);
    for (let k = 0; k < 4; k += 1) {
      g.strokeStyle = `rgba(${Math.min(255, r + 100)},${Math.min(255, gg + 100)},255,${0.12 + level * 0.2})`;
      g.beginPath();
      for (let i = 0; i <= 40; i += 1) {
        const x = cx - R + (i / 40) * R * 2;
        const y = cx + Math.sin(i / 6 + t * (1.2 + k * 0.4) + k) * R * (0.18 + k * 0.08) * (1 + level);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalCompositeOperation = "source-over";
    // Cœur lumineux et reflet.
    const core = g.createRadialGradient(cx, cx, 0, cx, cx, R * (0.32 + level * 0.25));
    core.addColorStop(0, "rgba(255,255,255,0.95)");
    core.addColorStop(0.4, `rgba(${Math.min(255, r + 140)},${Math.min(255, gg + 120)},${Math.min(255, b + 90)},0.6)`);
    core.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = core;
    g.fillRect(0, 0, w, w);
    const shine = g.createRadialGradient(cx - R * 0.35, cx - R * 0.45, 0, cx - R * 0.35, cx - R * 0.45, R * 0.5);
    shine.addColorStop(0, "rgba(255,255,255,0.35)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = shine;
    g.fillRect(0, 0, w, w);
    g.restore();

    // Liseré fin.
    g.strokeStyle = `rgba(${Math.min(255, r + 90)},${Math.min(255, gg + 90)},255,0.55)`;
    g.lineWidth = Math.max(1, w * 0.0035);
    g.beginPath();
    g.arc(cx, cx, R * 1.01, 0, Math.PI * 2);
    g.stroke();
  };
  requestAnimationFrame(frame);

  wrap.onclick = () => api.send("jarvis:listen");
  api.on("jarvis:state", ({ state: next }: { state: OrbState }) => {
    state = next;
    wrap.classList.remove("ecoute", "reflexion", "parole");
    if (next !== "veille") wrap.classList.add(next);
  });
  if (label) {
    const holder = el("div", "", "");
    holder.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:0";
    holder.append(wrap, el("div", "reactor-label", label));
    return holder;
  }
  return wrap;
}

// ---------- Barre du haut : boutons ronds des pages ----------

const SVG = (p: string) => `<svg class="i" viewBox="0 0 24 24">${p}</svg>`;
export const PAGE_ICONS: Array<{ id: string; label: string; icon: string }> = [
  { id: "accueil", label: "Accueil", icon: SVG('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>') },
  { id: "ingenieur", label: "Ingénieur", icon: SVG('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M3.5 10.5h6M14.5 10.5h6M12 14.5V21"/>') },
  { id: "travail", label: "Travail", icon: SVG('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 12h18"/>') },
  { id: "code", label: "Code", icon: SVG('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>') },
  { id: "rd", label: "R&D", icon: SVG('<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>') },
  { id: "securite", label: "Sécurité", icon: SVG('<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>') },
  { id: "performances", label: "Performances", icon: SVG('<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>') },
  { id: "reglages", label: "Réglages", icon: SVG('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>') },
  { id: "diagnostic", label: "Diagnostic", icon: SVG('<path d="M4 12h3l2-5 4 10 2-5h5"/><circle cx="12" cy="12" r="10"/>') },
];

export const ICONS = {
  calendar: SVG('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  bell: SVG('<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  sun: SVG('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  home: SVG('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>'),
  pulse: SVG('<path d="M3 12h4l3-7 4 14 3-7h4"/>'),
  mail: SVG('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  note: SVG('<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4M8 12h8M8 16h6"/>'),
  folder: SVG('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>'),
  code: SVG('<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>'),
  eye: SVG('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  book: SVG('<path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-4a2 2 0 0 0-2 2"/>'),
  cube: SVG('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  image: SVG('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
  camera: SVG('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  shield: SVG('<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z"/>'),
  motion: SVG('<circle cx="12" cy="5" r="2"/><path d="m10 21 2-7-3-3 2-4 4 3h3M7 13l-3 1"/>'),
  cpu: SVG('<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/>'),
  gpu: SVG('<rect x="2" y="7" width="20" height="10" rx="2"/><circle cx="8" cy="12" r="2.5"/><circle cx="16" cy="12" r="2.5"/>'),
  disk: SVG('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/>'),
  net: SVG('<path d="M12 20v-6M8 17l4 3 4-3M12 4v6M8 7l4-3 4 3"/>'),
  list: SVG('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  work: SVG('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2"/>'),
  team: SVG('<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.5c2.8 0 5 2.2 5 5"/>'),
  alarm: SVG('<circle cx="12" cy="13" r="7"/><path d="M12 9v4l2.5 2M5 4 2.5 6.5M19 4l2.5 2.5"/>'),
  grid: SVG('<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/>'),
  health: SVG('<path d="M4 12h3l2-5 4 10 2-5h5"/>'),
};

export interface PageShell {
  page: HTMLElement;
  left: HTMLElement;
  center: HTMLElement;
  right: HTMLElement;
  bottom?: HTMLElement;
  tools: HTMLElement;
}

/** Squelette commun : en-tête avec les boutons des pages, trois colonnes, Jarvis au centre. */
export function buildPage(options: { id: string; title: string; cols?: string; bottom?: boolean; extraClass?: string }): PageShell {
  const page = el("div", `page ${options.bottom ? "with-bottom" : ""} ${options.extraClass ?? ""}`);
  if (options.cols) page.style.setProperty("--cols", options.cols);
  const top = el("header", "top");
  const ident = el("div", "ident", `<b>J.A.R.V.I.S.</b><span>${esc(options.title)}</span>`);
  const nav = el("nav", "nav");
  for (const p of PAGE_ICONS) {
    const b = el("button", p.id === options.id ? "on" : "", `${p.icon}<span>${esc(p.label)}</span>`);
    b.title = p.label;
    b.onclick = () => p.id !== options.id && api.send("page:open", p.id);
    nav.append(b);
  }
  const tools = el("div", "tools");
  const clock = el("div", "clockbox");
  tools.append(clock);
  if (options.id !== "accueil") {
    const close = el("button", "close", SVG('<path d="M6 6l12 12M18 6 6 18"/>'));
    close.title = "Fermer (Échap)";
    close.onclick = () => api.send("page:close");
    tools.append(close);
    addEventListener("keydown", (e) => e.key === "Escape" && api.send("page:close"));
  }
  const tick = () => {
    const d = new Date();
    clock.innerHTML = `${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}<small>${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</small>`;
  };
  tick();
  setInterval(tick, 10_000);
  top.append(ident, nav, tools);
  const left = el("div", "col left");
  const center = el("div", "col center");
  const right = el("div", "col right");
  page.append(top, left, center, right);
  let bottom: HTMLElement | undefined;
  if (options.bottom) {
    bottom = el("div", "bottom");
    page.append(bottom);
  }
  return { page, left, center, right, ...(bottom ? { bottom } : {}), tools };
}

// ---------- Lignes de flux : Jarvis relié à ses panneaux ----------

/** Trace des liaisons lumineuses entre le réacteur et chaque panneau marqué data-link. */
export function linkToReactor(page: HTMLElement, reactor: HTMLElement): void {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "links";
  document.body.append(svg);
  const draw = () => {
    const r = reactor.getBoundingClientRect();
    if (!r.width) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const radius = r.width / 2;
    const paths: string[] = [];
    page.querySelectorAll<HTMLElement>("[data-link]").forEach((panel, i) => {
      const p = panel.getBoundingClientRect();
      if (!p.width || p.height < 20) return;
      const toLeft = p.right < cx;
      const ex = toLeft ? p.right : p.left;
      const ey = Math.min(Math.max(p.top + 26, cy - 1e9), p.bottom - 10);
      const targetY = Math.max(p.top + 22, Math.min(p.bottom - 22, ey));
      const angle = Math.atan2(targetY - cy, ex - cx);
      const sx = cx + Math.cos(angle) * radius * 0.92;
      const sy = cy + Math.sin(angle) * radius * 0.92;
      const mid = toLeft ? Math.min(sx - 24, ex + (sx - ex) * 0.45) : Math.max(sx + 24, ex - (ex - sx) * 0.45);
      const d = `M${sx.toFixed(1)} ${sy.toFixed(1)} H${mid.toFixed(1)} V${targetY.toFixed(1)} H${ex.toFixed(1)}`;
      paths.push(`<path class="base" d="${d}"/><path class="flow" d="${d}" style="animation-delay:${-i * 0.7}s"/><circle cx="${ex.toFixed(1)}" cy="${targetY.toFixed(1)}" r="3"/>`);
    });
    svg.innerHTML = paths.join("");
  };
  const schedule = () => requestAnimationFrame(draw);
  new ResizeObserver(schedule).observe(page);
  page.querySelectorAll("[data-link]").forEach((n) => new ResizeObserver(schedule).observe(n));
  addEventListener("resize", schedule);
  setTimeout(draw, 700);
}

// ---------- Jauges circulaires ----------

export function gauge(options: { pct?: number; size: number; stroke?: number; value: string; label?: string; ticks?: boolean; fontSize?: number; accent?: "warn" | "danger" | "" }): string {
  const s = options.size;
  const stroke = options.stroke ?? 6;
  const r = s / 2 - stroke - (options.ticks ? 8 : 2);
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, options.pct ?? 0));
  const ticks = options.ticks
    ? Array.from({ length: 60 }, (_, i) => {
        const a = (i / 60) * Math.PI * 2;
        const r0 = s / 2 - 5;
        const r1 = s / 2 - (i % 5 === 0 ? 1 : 3);
        return `<line class="tick" x1="${(s / 2 + r0 * Math.cos(a)).toFixed(1)}" y1="${(s / 2 + r0 * Math.sin(a)).toFixed(1)}" x2="${(s / 2 + r1 * Math.cos(a)).toFixed(1)}" y2="${(s / 2 + r1 * Math.sin(a)).toFixed(1)}" stroke-width="1"/>`;
      }).join("")
    : "";
  const cls = options.accent ?? (pct >= 90 ? "danger" : pct >= 75 ? "warn" : "");
  return `<div class="gaugebox" style="width:${s}px;height:${s}px;--gsize:${options.fontSize ?? Math.round(s / 5)}px"><svg viewBox="0 0 ${s} ${s}">${ticks}
    <circle class="bg" cx="${s / 2}" cy="${s / 2}" r="${r}" stroke-width="${stroke}"/>
    <circle class="fg ${options.pct === undefined ? "" : cls}" cx="${s / 2}" cy="${s / 2}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - pct / 100)).toFixed(1)}"/></svg>
    <div class="in"><b>${esc(options.value)}</b>${options.label ? `<small>${esc(options.label)}</small>` : ""}</div></div>`;
}

/** Grappe d'hexagones décorative (coin bas droit), quelques cellules allumées. */
export function hexes(): string {
  const cells: string[] = [];
  const size = 14;
  const w = Math.sqrt(3) * size;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 7 - row; col += 1) {
      const x = 20 + col * w + row * (w / 2);
      const y = 20 + row * size * 1.5;
      const pts = Array.from({ length: 6 }, (_, k) => {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        return `${(x + size * Math.cos(a)).toFixed(1)},${(y + size * Math.sin(a)).toFixed(1)}`;
      }).join(" ");
      cells.push(`<polygon class="${(row * 7 + col) % 5 === 0 ? "on" : ""}" points="${pts}" style="animation-delay:${(row + col) * 0.3}s"/>`);
    }
  }
  return `<div class="hexes"><svg viewBox="0 0 200 110">${cells.join("")}</svg></div>`;
}

/** Niveau sonore (voix de Jarvis ou d'Alex) : fait vibrer la boule. */
export function setReactorLevel(level: number): void {
  voiceLevel.value = Math.min(1, Math.max(0, level));
}
