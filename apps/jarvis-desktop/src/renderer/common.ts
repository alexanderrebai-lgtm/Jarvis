import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { renderMarkdown } from "../shared/markdown.js";

export interface JarvisBridge {
  send: (channel: string, payload?: unknown) => void;
  invoke: <T = unknown>(channel: string, payload?: unknown) => Promise<T>;
  on: (channel: string, listener: (payload: any) => void) => () => void;
}

export const api = (window as unknown as { jarvis: JarvisBridge }).jarvis;

export function esc(text: unknown): string {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", html = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html) node.innerHTML = html;
  return node;
}

const SVG = (path: string) => `<svg class="i" viewBox="0 0 24 24">${path}</svg>`;
export const ICON = {
  close: SVG('<path d="M6 6l12 12M18 6 6 18"/>'),
  mic: SVG('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  soleil: SVG('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  nuageux: SVG('<path d="M8 6.5A4 4 0 0 1 15.6 8"/><path d="M7 19h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 19Z"/>'),
  couvert: SVG('<path d="M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 18Z"/>'),
  brouillard: SVG('<path d="M4 9h16M3 13h18M5 17h14"/>'),
  bruine: SVG('<path d="M7 14h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14Z"/><path d="M9 18v.5M13 18v.5M17 18v.5"/>'),
  pluie: SVG('<path d="M7 14h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14Z"/><path d="M9 17l-1 3M13 17l-1 3M17 17l-1 3"/>'),
  neige: SVG('<path d="M7 14h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14Z"/><path d="M9 18h.01M13 20h.01M17 18h.01"/>'),
  orage: SVG('<path d="M7 14h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14Z"/><path d="m12 14-2 4h3l-2 4"/>'),
  bulb: SVG('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3Z"/>'),
  plug: SVG('<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4"/>'),
};

export const lapText = (s?: number) => (s && s > 0 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}` : "—");
export const gapText = (s?: number) => (s === undefined || s === null ? "—" : `${s.toFixed(1).replace(".", ",")} s`);
export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** En-tête de page : titre à gauche, JARVIS au centre, éléments et bouton fermer à droite. */
export function pageHead(title: string, closable: boolean): { head: HTMLElement; right: HTMLElement } {
  const head = el("header", "head", `<div class="title"><b>${esc(title)}</b></div><div class="center"><b>JARVIS</b> · <span data-clock></span></div>`);
  const right = el("div", "right");
  head.append(right);
  if (closable) {
    const close = el("button", "close", ICON.close);
    close.title = "Fermer (Échap)";
    close.onclick = () => api.send("page:close");
    right.append(close);
    window.addEventListener("keydown", (e) => e.key === "Escape" && api.send("page:close"));
  }
  const tick = () => head.querySelectorAll("[data-clock]").forEach((n) => (n.textContent = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })));
  tick();
  setInterval(tick, 10_000);
  return { head, right };
}

export function panel(title: string, className = "", options: { icon?: string; accent?: "violet" | "gold" | "green" | "red"; link?: boolean } = {}): { root: HTMLElement; body: HTMLElement; title: HTMLElement } {
  const root = el("section", `panel ${className}`);
  if (options.accent) root.dataset.accent = options.accent;
  if (options.link !== false) root.dataset.link = "";
  const h = el("h4", "", `${options.icon ? `<span class="ic">${options.icon}</span>` : ""}<span>${esc(title)}</span>`);
  const body = el("div", className.includes("grow") ? "scroll" : "");
  root.append(h, body);
  return { root, body, title: h };
}

/** Affiche un modèle STL qu'on peut tourner à la souris ; renvoie de quoi le faire tourner d'un geste. */
/** Un STL binaire annonce son nombre de triangles : on vérifie que la taille correspond avant de le lire. */
export function looksLikeStl(data: ArrayBuffer): boolean {
  if (data.byteLength < 15) return false;
  const head = new TextDecoder().decode(new Uint8Array(data, 0, Math.min(256, data.byteLength)));
  if (/^\s*solid\b/.test(head) && /facet|endsolid/.test(new TextDecoder().decode(new Uint8Array(data, 0, Math.min(4096, data.byteLength))))) return true;
  if (data.byteLength < 84) return false;
  const faces = new DataView(data).getUint32(80, true);
  return 84 + faces * 50 === data.byteLength;
}

/** Charge un STL depuis une adresse et l'affiche ; message clair si le fichier manque ou est abîmé. */
export async function showModelFrom(container: HTMLElement, url: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("fichier introuvable");
    showModel(container, await response.arrayBuffer());
  } catch (error) {
    container.innerHTML = `<div class="empty">Modèle 3D illisible (${esc(error instanceof Error ? error.message : error)}).</div>`;
  }
}

export function showModel(container: HTMLElement, data: ArrayBuffer): { rotate: (dx: number, dy: number) => void } {
  if (!looksLikeStl(data)) throw new Error("ce n'est pas un fichier STL valide");
  container.classList.add("stage3d");
  const canvas = el("canvas");
  container.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 10_000);
  scene.add(new THREE.AmbientLight(0xbfe9ff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(1, 2, 3);
  const rim = new THREE.DirectionalLight(0x9fe8ff, 0.9);
  rim.position.set(-3, 1, -2);
  scene.add(key, rim);
  const geometry = new STLLoader().parse(data);
  geometry.rotateX(-Math.PI / 2); // CAO : Z vers le haut
  geometry.center();
  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere?.radius ?? 1;
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x0b2a3a, metalness: 0.2, roughness: 0.35, transparent: true, opacity: 0.88 })),
    new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({ color: 0xe6faff, transparent: true, opacity: 0.45 })),
  );
  scene.add(group);
  const grid = new THREE.GridHelper(radius * 4, 20, 0x9fe8ff, 0x1d3a4a);
  grid.position.y = -radius * 0.9;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.35;
  scene.add(grid);
  camera.position.set(radius * 1.6, radius * 1.3, radius * 2.1);
  camera.lookAt(0, 0, 0);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  const resize = () => {
    renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), false);
    camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();
  // 30 images par seconde suffisent, et rien quand la page est cachée : la carte graphique reste au simulateur.
  let last = 0;
  const tick = (now: number) => {
    if (!canvas.isConnected) return renderer.dispose();
    requestAnimationFrame(tick);
    if (document.hidden || now - last < 33) return;
    last = now;
    group.rotation.y += 0.003;
    controls.update();
    renderer.render(scene, camera);
  };
  requestAnimationFrame(tick);
  return { rotate: (dx, dy) => ((group.rotation.y += dx), (group.rotation.x += dy)) };
}

export function base64ToBuffer(base64: string): ArrayBuffer {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
}

export interface PanelPayload {
  titre: string;
  markdown?: string;
  imageDataUrl?: string;
  modelData?: string;
}

/** Contenu d'un panneau envoyé par Jarvis (texte, image, modèle 3D). */
export function fillPanel(body: HTMLElement, payload: PanelPayload): { rotate: (dx: number, dy: number) => void } | undefined {
  body.replaceChildren();
  if (payload.modelData) {
    try {
      return showModel(body, base64ToBuffer(payload.modelData));
    } catch (error) {
      body.innerHTML = `<div class="empty">${esc(error instanceof Error ? error.message : error)}</div>`;
      return undefined;
    }
  }
  if (payload.markdown) body.append(el("div", "md", renderMarkdown(payload.markdown)));
  if (payload.imageDataUrl && /^data:image\//.test(payload.imageDataUrl)) {
    const img = el("img");
    img.src = payload.imageDataUrl;
    body.append(img);
  }
  return undefined;
}

/** Niveau de la voix (de Jarvis ou d'Alex), lu par la boule à chaque image. */
export const voiceLevel = { value: 0 };

/** Niveau de voix : fait vibrer la boule de Jarvis. */
export function setCoreLevel(level: number): void {
  voiceLevel.value = Math.min(1, Math.max(0, level));
}
