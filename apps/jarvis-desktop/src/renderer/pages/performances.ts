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

  const past: Array<{ cpu: number; gpu?: number; ram: number }> = [];
  const render = (p: Perf | null) => {
    if (!p) return;
    const g = p.gpu[0];
    past.push({ cpu: p.cpu.chargePct, ...(g?.chargePct !== undefined ? { gpu: g.chargePct } : {}), ram: p.memoire.pct });
    if (past.length > 60) past.shift();
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
    draw(canvas, past);
  };
  api.on("perf:data", render);
  void api.invoke<{ perf: Perf | null }>("page:data", "performances").then((d) => render(d.perf));
}

function draw(canvas: HTMLCanvasElement, past: Array<{ cpu: number; gpu?: number; ram: number }>): void {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * ratio;
  canvas.height = canvas.clientHeight * ratio;
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const series: Array<[keyof (typeof past)[number], string]> = [["cpu", "rgba(159,232,255,0.95)"], ["gpu", "rgba(185,166,255,0.95)"], ["ram", "rgba(125,255,196,0.7)"]];
  const x = (i: number) => (i / 59) * canvas.width;
  const y = (v: number) => canvas.height - (v / 100) * (canvas.height - 10 * ratio) - 5 * ratio;
  for (const [key, color] of series) {
    const points = past.map((p, i) => [i + (60 - past.length), p[key]] as const).filter(([, v]) => v !== undefined) as Array<readonly [number, number]>;
    if (points.length < 2) continue;
    g.strokeStyle = color;
    g.lineWidth = 2 * ratio;
    g.shadowColor = color;
    g.shadowBlur = 6 * ratio;
    g.beginPath();
    points.forEach(([i, v], n) => (n ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
    g.stroke();
  }
  g.shadowBlur = 0;
  g.fillStyle = "rgba(220,240,255,0.5)";
  g.font = `${11 * ratio}px Inter`;
  g.fillText("processeur", 8 * ratio, 16 * ratio);
  g.fillStyle = "rgba(185,166,255,0.9)";
  g.fillText("carte graphique", 90 * ratio, 16 * ratio);
  g.fillStyle = "rgba(125,255,196,0.8)";
  g.fillText("mémoire", 200 * ratio, 16 * ratio);
}
