import { api, el, esc, fillPanel, gapText, lapText, panel, type PanelPayload } from "../common.js";
import { buildPage, createReactor } from "../hud.js";

interface Lap { numero: number; tempsS: number; valide: boolean; position?: number }
interface Race {
  jeu: string;
  session?: string;
  piste?: string;
  enCourse?: boolean;
  totalTours?: number;
  tempsRestantS?: number;
  tour?: number;
  position?: number;
  nbVoitures?: number;
  classe?: string;
  dernierTourS?: number;
  meilleurTourS?: number;
  tourActuelS?: number;
  ecartDevantS?: number;
  ecartDerriereS?: number;
  ecartLeaderS?: number;
  pilotes?: { devant?: string; derriere?: string };
  carburant?: { restant?: number; capacite?: number; unite: string; parTour?: number; toursRestants?: number; margeTours?: number };
  energie?: { fraction: number; parTour?: number; toursRestants?: number };
  pneus?: { compose?: string; age?: number; surface?: number[]; usure?: number[] };
  degats?: Record<string, number>;
  drapeau?: string;
  penalitesS?: number;
  stand?: { arrets?: number; tourIdeal?: number; tourMax?: number };
  meteo?: { pluieProchainePct?: number; pisteC?: number; airC?: number };
  tours: Lap[];
}

const LED_COLORS = ["g", "g", "g", "g", "o", "o", "o", "r", "r", "r", "p", "p"];

/** Page Ingénieur : l'écran d'un volant de LMH ou de F1, avec Jarvis au centre. */
export function renderEngineer(root: HTMLElement): void {
  document.body.classList.add("cockpit");
  const { page, left, center, right, bottom, tools } = buildPage({ id: "ingenieur", title: "Ingénieur de course", cols: "minmax(280px, 22%) 1fr minmax(300px, 23%)", bottom: true });
  const info = el("span", "chip off", "<i></i>En attente");
  tools.prepend(info);

  const radio = panel("Radio", "grow", { link: false });
  radio.title.innerHTML = '<span>Radio</span><small><b>● REC</b></small>';
  radio.body.classList.add("radio");
  left.append(radio.root);

  const leds = el("div", "leds", LED_COLORS.map(() => "<i></i>").join(""));
  const modes = el("div", "modes", '<span class="on">COURSE</span><span>STRATÉGIE</span><span>PNEUS</span><span>RADIO</span>');
  const flag = el("div", "flagstrip");
  const hero = el("section", "panel cockpit-hero");
  hero.dataset.link = "";
  const reactor = createReactor(230);
  const lapBox = el("div", "", '<div class="lap-label">Dernier tour</div><div class="lap">—</div><div class="lap-label kpi"></div><div class="say">Lance F1 ou Le Mans Ultimate : je suis à l\'écoute dès que tu es en piste.</div>');
  hero.append(reactor, lapBox);
  const viewer = el("section", "panel viewer hidden", '<h4><span class="vt"></span><button class="close">✕</button></h4><div class="body"></div>');
  const ptt = el("div", "ptt", "<b>PTT</b>Bouton du volant ou « Jarvis… » · Ctrl Alt Espace");
  const stack = el("div", "", "");
  stack.style.cssText = "position:relative;flex:1;width:100%;display:flex;flex-direction:column;gap:14px;min-height:0";
  stack.append(hero, viewer);
  center.append(leds, modes, flag, stack, ptt);
  center.style.alignItems = "stretch";
  modes.style.justifyContent = "center";

  const gaps = panel("Écarts", "", { link: false });
  const tyres = panel("Pneus", "", { link: false });
  const laps = panel("Tours", "grow", { link: false });
  right.append(gaps.root, tyres.root, laps.root);

  const cells = el("div", "cells");
  bottom!.append(cells);

  root.append(page);

  // LED : elles s'allument en vague quand Jarvis parle, et en rouge sous drapeau jaune ou voiture de sécurité.
  let speaking = false;
  let warning = false;
  const ledNodes = [...leds.querySelectorAll("i")];
  let phase = 0;
  setInterval(() => {
    phase += 1;
    const level = speaking ? 5 + Math.round(Math.abs(Math.sin(phase / 2)) * 7) : warning ? (phase % 2 ? 12 : 0) : 0;
    ledNodes.forEach((n, i) => (n.className = i < level ? (warning && !speaking ? "r" : LED_COLORS[i]!) : ""));
  }, 90);
  api.on("jarvis:state", ({ state }: { state: string }) => (speaking = state === "parole"));

  viewer.querySelector<HTMLButtonElement>(".close")!.onclick = () => viewer.classList.add("hidden");
  api.on("jarvis:panel", (payload: PanelPayload) => {
    viewer.classList.remove("hidden");
    viewer.querySelector(".vt")!.textContent = payload.titre;
    fillPanel(viewer.querySelector<HTMLElement>(".body")!, payload);
  });

  const say = lapBox.querySelector(".say")!;
  api.on("jarvis:message", ({ from, text, radio: isRadio }: { from: string; text: string; radio?: boolean }) => {
    const clean = text.replace(/^📻\s*/, "");
    if (from === "jarvis") say.innerHTML = esc(clean).replace(/([−+-]?\d+[,.]\d+\s?s?|meilleur tour !|Box, box !)/gi, "<em>$1</em>");
    if (from === "jarvis" && !isRadio && !text.startsWith("📻")) return;
    const msg = el("div", `msg ${from}`);
    msg.textContent = clean;
    radio.body.prepend(msg);
    while (radio.body.children.length > 60) radio.body.lastChild?.remove();
  });

  const render = (s: Race | null) => {
    if (!s) {
      info.className = "chip off";
      info.innerHTML = "<i></i>Aucune séance";
      cells.innerHTML = ["Carburant", "Autonomie", "Pneus", "Position", "Restant"].map((l) => `<div><div class="label">${l}</div><div class="metric">—</div><div class="bar"></div></div>`).join("");
      return;
    }
    const flags: Record<string, string> = { jaune: "Jaune", safety_car: "Voiture de sécurité", vsc: "VSC", rouge: "Rouge", bleu: "Bleu", damier: "Damier" };
    info.className = `chip ${s.drapeau && s.drapeau !== "vert" ? "warn" : ""}`;
    info.innerHTML = `<i></i>${esc(s.jeu === "LMU" ? "Le Mans Ultimate" : "F1")} · ${esc(s.session ?? "")}${s.piste ? ` · ${esc(s.piste)}` : ""}${s.drapeau && flags[s.drapeau] ? ` · ${flags[s.drapeau]}` : ""}`;
    flag.className = `flagstrip ${s.drapeau ?? ""}`;
    warning = s.drapeau === "jaune" || s.drapeau === "safety_car" || s.drapeau === "vsc" || s.drapeau === "rouge";

    lapBox.querySelector(".lap")!.textContent = lapText(s.dernierTourS);
    const delta = s.dernierTourS && s.meilleurTourS ? s.dernierTourS - s.meilleurTourS : undefined;
    lapBox.querySelector(".kpi")!.innerHTML = `Meilleur ${lapText(s.meilleurTourS)} · ${delta === undefined ? "" : delta <= 0.0005 ? '<span class="good">record</span>' : `<span class="bad">+${delta.toFixed(3)}</span>`} · Tour ${s.tour ?? "—"}${s.totalTours ? `/${s.totalTours}` : ""} · En cours ${lapText(s.tourActuelS)}`;

    gaps.body.innerHTML = `
      <div class="row"><span>P${s.position ?? "—"}${s.nbVoitures ? ` / ${s.nbVoitures}` : ""}${s.classe ? ` · ${esc(s.classe)}` : ""}</span><span class="v">${s.penalitesS ? `<span class="bad">+${s.penalitesS} s</span>` : ""}</span></div>
      <div class="row"><span>${esc(s.pilotes?.devant ?? "Devant")}</span><span class="v bad">${s.ecartDevantS !== undefined ? `+${s.ecartDevantS.toFixed(3)}` : "—"}</span></div>
      <div class="row"><span>${esc(s.pilotes?.derriere ?? "Derrière")}</span><span class="v good">${s.ecartDerriereS !== undefined ? `−${s.ecartDerriereS.toFixed(3)}` : "—"}</span></div>
      <div class="row"><span>Leader</span><span class="v">${s.position === 1 ? "—" : gapText(s.ecartLeaderS)}</span></div>`;

    const tyre = (i: number, name: string) => {
      const t = s.pneus?.surface?.[i];
      const w = s.pneus?.usure?.[i];
      return `<div class="${t !== undefined && t > 105 ? "hot" : ""} ${w !== undefined && w > 60 ? "worn" : ""}">${name}<b>${t !== undefined ? `${Math.round(t)}°` : "—"}</b>${w !== undefined ? `${Math.round(w)} %` : ""}</div>`;
    };
    tyres.title.innerHTML = `<span>Pneus</span><small>${esc(s.pneus?.compose ?? "")}${s.pneus?.age !== undefined ? ` · ${s.pneus.age} t.` : ""}</small>`;
    tyres.body.innerHTML = `<div class="tyres4">${tyre(0, "AVG")}${tyre(1, "AVD")}${tyre(2, "ARG")}${tyre(3, "ARD")}</div>`;

    const recent = [...s.tours].reverse().slice(0, 14);
    laps.body.innerHTML = recent.length
      ? recent.map((l) => `<div class="row"><span>T${l.numero}${l.position ? ` · P${l.position}` : ""}</span><span class="v ${!l.valide ? "bad" : l.tempsS === s.meilleurTourS ? "good" : "strong"}">${lapText(l.tempsS)}${l.valide ? "" : " ✕"}</span></div>`).join("")
      : '<div class="empty">Les tours s\'afficheront ici.</div>';

    // Cases du bas, comme sur un volant
    const fuel = s.carburant;
    const energy = s.energie && s.jeu === "LMU" ? s.energie : undefined;
    const fuelPct = energy ? energy.fraction * 100 : fuel?.restant !== undefined && fuel.capacite ? (fuel.restant / fuel.capacite) * 100 : undefined;
    const autonomy = energy?.toursRestants ?? fuel?.toursRestants;
    const maxTemp = s.pneus?.surface?.length ? Math.max(...s.pneus.surface) : undefined;
    const remaining = s.totalTours && s.tour ? `${s.totalTours - s.tour + 1}<small> tours</small>` : s.tempsRestantS ? `${Math.round(s.tempsRestantS / 60)}<small> min</small>` : "—";
    const bar = (pct: number | undefined, cls = "") => `<div class="bar"><i class="${cls}" style="width:${Math.max(0, Math.min(100, pct ?? 0))}%"></i></div>`;
    cells.innerHTML = [
      `<div><div class="label">${energy ? "Énergie" : "Carburant"}</div><div class="metric">${fuelPct !== undefined ? `${Math.round(fuelPct)}<small> %</small>` : fuel?.restant !== undefined ? `${fuel.restant}<small> ${fuel.unite}</small>` : "—"}</div>${bar(fuelPct, fuelPct !== undefined && fuelPct < 15 ? "r" : "")}</div>`,
      `<div><div class="label">Autonomie</div><div class="metric">${fuel?.margeTours !== undefined && !energy ? `${fuel.margeTours >= 0 ? "+" : ""}${fuel.margeTours.toFixed(1)}<small> tour</small>` : autonomy !== undefined ? `${autonomy.toFixed(1)}<small> tours</small>` : "—"}</div>${bar(autonomy !== undefined ? Math.min(100, autonomy * 8) : undefined)}</div>`,
      `<div><div class="label">Pneus max</div><div class="metric">${maxTemp !== undefined ? `${Math.round(maxTemp)}<small> °C</small>` : "—"}</div>${bar(maxTemp !== undefined ? Math.min(100, maxTemp - 20) : undefined, maxTemp !== undefined && maxTemp > 105 ? "r" : "")}</div>`,
      `<div><div class="label">Position</div><div class="metric">P${s.position ?? "—"}<small>${s.nbVoitures ? ` / ${s.nbVoitures}` : ""}</small></div>${bar(s.position && s.nbVoitures ? (1 - (s.position - 1) / s.nbVoitures) * 100 : undefined, "g")}</div>`,
      `<div><div class="label">Restant</div><div class="metric">${remaining}</div>${bar(s.totalTours && s.tour ? (s.tour / s.totalTours) * 100 : undefined)}</div>`,
    ].join("");
  };

  render(null);
  api.on("race:state", render);
  void api.invoke<{ raceState: Race | null }>("page:data", "ingenieur").then((d) => render(d.raceState));
}
