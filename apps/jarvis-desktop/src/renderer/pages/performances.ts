import { api, el, esc, panel } from "../common.js";
import { buildPage, createReactor, gauge, ICONS, linkToReactor } from "../hud.js";

interface Perf {
  cpu: { modele: string; chargePct: number; coeurs: number[]; temperatureC?: number; frequenceGHz?: number };
  memoire: { utiliseeGo: number; totaleGo: number; pct: number };
  gpu: Array<{ modele: string; chargePct?: number; memoireUtiliseeGo?: number; memoireTotaleGo?: number; temperatureC?: number; ventilateurPct?: number; puissanceW?: number }>;
  disques: Array<{ lecteur: string; utilisePct: number; libreGo: number }>;
  reseau: { recuMbps: number; envoyeMbps: number };
  processus: Array<{ nom: string; cpuPct: number; memoireMo: number }>;
  alertes: string[];
}

export function renderPerformance(root: HTMLElement): void {
  const { page, left, center, right, tools } = buildPage({ id: "performances", title: "Performances du PC", cols: "minmax(280px, 22%) 1fr minmax(300px, 23%)" });
  const alerts = el("span", "chip", "<i></i>Tout va bien");
  tools.prepend(alerts);

  const cpu = panel("Processeur", "", { icon: ICONS.cpu, accent: "green" });
  const gpu = panel("Carte graphique", "grow", { icon: ICONS.gpu, accent: "violet" });
  left.append(cpu.root, gpu.root);

  const reactor = createReactor(Math.round(Math.min(innerHeight * 0.26, 240)), "J.A.R.V.I.S.");
  const rings = el("div", "ringsrow");
  const history = panel("Historique · 2 minutes", "grow", { icon: ICONS.pulse, link: false });
  const canvas = el("canvas", "spark");
  history.body.append(canvas);
  center.append(reactor, rings, history.root);
  center.style.alignItems = "stretch";
  reactor.style.alignSelf = "center";

  const disks = panel("Disques", "", { icon: ICONS.disk, accent: "gold" });
  const net = panel("Réseau", "", { icon: ICONS.net });
  const procs = panel("Programmes", "grow", { icon: ICONS.list, accent: "green" });
  right.append(disks.root, net.root, procs.root);
  root.append(page);
  linkToReactor(page, reactor.querySelector<HTMLElement>(".reactor")!);

  // Historique sur 2 minutes, horodaté : le graphique défile en continu entre deux mesures.
  const past: Sample[] = [];
  const render = (p: Perf | null) => {
    if (!p) return;
    const g = p.gpu[0];
    past.push({ t: Date.now(), cpu: p.cpu.chargePct, ...(g?.chargePct !== undefined ? { gpu: g.chargePct } : {}), ram: p.memoire.pct });
    while (past.length && Date.now() - past[0]!.t > HISTORY_MS + 5_000) past.shift();
    alerts.className = `chip ${p.alertes.length ? "danger" : ""}`;
    alerts.innerHTML = `<i></i>${esc(p.alertes[0] ?? "Tout va bien")}`;
    rings.innerHTML =
      gauge({ pct: p.cpu.chargePct, size: 150, stroke: 7, ticks: true, value: `${Math.round(p.cpu.chargePct)}%`, label: p.cpu.temperatureC !== undefined ? `Processeur · ${Math.round(p.cpu.temperatureC)}°` : "Processeur", fontSize: 30 }) +
      gauge({ pct: g?.chargePct, size: 150, stroke: 7, ticks: true, value: g?.chargePct !== undefined ? `${g.chargePct}%` : "—", label: g?.temperatureC !== undefined ? `Graphique · ${g.temperatureC}°` : "Carte graphique", fontSize: 30 }) +
      gauge({ pct: p.memoire.pct, size: 150, stroke: 7, ticks: true, value: `${Math.round(p.memoire.pct)}%`, label: `Mémoire · ${p.memoire.utiliseeGo}/${p.memoire.totaleGo} Go`, fontSize: 30 });
    cpu.body.innerHTML = `<div class="row"><span>${esc(p.cpu.modele || "Processeur")}</span></div>
      <div class="row"><span>Charge</span><span class="v strong">${Math.round(p.cpu.chargePct)} %</span></div>
      <div class="row"><span>Température</span><span class="v ${p.cpu.temperatureC && p.cpu.temperatureC > 85 ? "bad" : ""}">${p.cpu.temperatureC !== undefined ? `${Math.round(p.cpu.temperatureC)} °C` : "non exposée par Windows"}</span></div>
      <div class="row"><span>Fréquence</span><span class="v">${p.cpu.frequenceGHz ? `${p.cpu.frequenceGHz} GHz` : "—"}</span></div>
      <div class="label" style="margin:12px 0 0 10px">Cœurs</div><div class="cores" style="margin-top:8px">${p.cpu.coeurs.map((c) => `<i style="height:${Math.max(3, c)}%"></i>`).join("")}</div>`;
    gpu.body.innerHTML = p.gpu.length
      ? p.gpu.map((x) => `<div class="row"><span>${esc(x.modele)}</span></div>
          <div class="row"><span>Charge</span><span class="v strong">${x.chargePct !== undefined ? `${x.chargePct} %` : "—"}</span></div>
          <div class="row"><span>Mémoire vidéo</span><span class="v">${x.memoireUtiliseeGo !== undefined ? `${x.memoireUtiliseeGo} / ${x.memoireTotaleGo ?? "?"} Go` : "—"}</span></div>
          <div class="row"><span>Température</span><span class="v ${x.temperatureC && x.temperatureC > 82 ? "bad" : ""}">${x.temperatureC !== undefined ? `${x.temperatureC} °C` : "—"}</span></div>
          <div class="row"><span>Ventilateur · conso</span><span class="v">${x.ventilateurPct !== undefined ? `${x.ventilateurPct} %` : "—"} · ${x.puissanceW !== undefined ? `${x.puissanceW} W` : "—"}</span></div>`).join("")
      : '<div class="empty">Carte graphique non détectée.</div>';
    disks.body.innerHTML = p.disques.map((d) => `<div class="row"><span>${esc(d.lecteur)}</span><span class="v">${d.libreGo} Go libres</span></div><div class="gauge"><i class="${d.utilisePct > 92 ? "danger" : d.utilisePct > 80 ? "warn" : ""}" style="width:${d.utilisePct}%"></i></div>`).join("");
    net.body.innerHTML = `<div class="row"><span>Réception</span><span class="v strong">${p.reseau.recuMbps} Mb/s</span></div><div class="row"><span>Envoi</span><span class="v strong">${p.reseau.envoyeMbps} Mb/s</span></div>`;
    procs.body.innerHTML = p.processus.map((x) => `<div class="row"><span>${esc(x.nom)}</span><span class="v">${x.cpuPct} % · ${x.memoireMo} Mo</span></div>`).join("");
  };
  // Dessin à 30 images/s, seulement quand la page est visible et hors mode jeu.
  let lastFrame = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    if (document.hidden || document.body.classList.contains("mode-jeu") || now - lastFrame < 33) return;
    lastFrame = now;
    draw(canvas, past);
  };
  requestAnimationFrame(frame);
  api.on("perf:data", render);
  void api.invoke<{ perf: Perf | null }>("page:data", "performances").then((d) => render(d.perf));
}

interface Sample {
  t: number;
  cpu: number;
  gpu?: number;
  ram: number;
}

const HISTORY_MS = 120_000;

function draw(canvas: HTMLCanvasElement, past: Sample[]): void {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(canvas.clientWidth * ratio);
  const height = Math.round(canvas.clientHeight * ratio);
  // Redimensionner un canvas vide sa mémoire : seulement si la taille change.
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, width, height);
  const now = Date.now();
  const x = (t: number) => width * (1 - (now - t) / HISTORY_MS);
  const y = (v: number) => height - (v / 100) * (height - 10 * ratio) - 5 * ratio;
  // Repères à 25, 50 et 75 %.
  g.strokeStyle = "rgba(160,220,255,0.08)";
  g.lineWidth = 1;
  for (const v of [25, 50, 75]) {
    g.beginPath();
    g.moveTo(0, y(v));
    g.lineTo(width, y(v));
    g.stroke();
  }
  const series: Array<[keyof Omit<Sample, "t">, string]> = [["cpu", "rgba(159,232,255,0.95)"], ["gpu", "rgba(185,166,255,0.95)"], ["ram", "rgba(125,255,196,0.7)"]];
  for (const [key, color] of series) {
    const points = past.filter((p) => p[key] !== undefined);
    if (points.length < 2) continue;
    g.strokeStyle = color;
    g.lineWidth = 2 * ratio;
    g.lineJoin = "round";
    g.beginPath();
    points.forEach((p, n) => (n ? g.lineTo(x(p.t), y(p[key]!)) : g.moveTo(x(p.t), y(p[key]!))));
    g.stroke();
  }
  g.fillStyle = "rgba(220,240,255,0.5)";
  g.font = `${11 * ratio}px Inter`;
  g.fillText("processeur", 8 * ratio, 16 * ratio);
  g.fillStyle = "rgba(185,166,255,0.9)";
  g.fillText("carte graphique", 90 * ratio, 16 * ratio);
  g.fillStyle = "rgba(125,255,196,0.8)";
  g.fillText("mémoire", 200 * ratio, 16 * ratio);
}
