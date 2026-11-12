import { api, el, esc, fillPanel, hhmm, ICON, panel, type PanelPayload } from "../common.js";
import { buildPage, createReactor, gauge, hexes, ICONS, linkToReactor } from "../hud.js";
import { flags, onGesture, startMicrophone, startWebcams, watchWheel } from "../senses.js";

interface HomeData {
  ownerName: string;
  flags: typeof flags;
  events: Array<{ summary: string; start: string; end: string; allDay: boolean; location: string }>;
  rappels: Array<{ texte: string; rappelLe?: string }>;
  notes: Array<{ texte: string }>;
  unread: Array<{ from: string; subject: string }>;
  devices: Array<{ nom: string; type: string; allume: boolean | null; luminosite?: number }>;
  meteo: Weather | null;
  race: { jeu: string; session?: string; piste?: string; position?: number } | null;
  pttButton: number | null;
  reveil: Alarm | null;
  taches: Array<{ id: string; titre: string; etapes: string[] }>;
  dispositions: Array<{ nom: string; pages: Array<{ page: string; ecran: string }> }>;
  mentor: "fais" | "avec" | "guide";
  revisions: number;
}

interface Alarm {
  phase: string;
  prochain?: { date: string; heure: string; raison: string };
}

const PAGE_NAMES: Record<string, string> = { accueil: "Accueil", ingenieur: "Ingénieur", travail: "Travail", code: "Code", rd: "R&D", securite: "Sécurité", performances: "Perf.", diagnostic: "Diagnostic" };

interface Weather {
  ville: string;
  maintenant: { temperature: number; ressenti: number; libelle: string; icone: keyof typeof ICON; ventKmh: number };
  aujourdhui: { min: number; max: number; pluiePct: number; lever?: string; coucher?: string };
  demain?: { min: number; max: number; libelle: string; icone?: keyof typeof ICON; pluiePct?: number };
  prochainesHeures: Array<{ heure: string; temperature: number; pluiePct: number; icone: keyof typeof ICON }>;
}

interface Perf { cpu: { chargePct: number; temperatureC?: number }; memoire: { pct: number; utiliseeGo: number; totaleGo: number }; gpu: Array<{ chargePct?: number; temperatureC?: number }>; disques: Array<{ lecteur: string; utilisePct: number }>; reseau: { recuMbps: number } }

export function renderHome(root: HTMLElement): void {
  const shell = buildPage({ id: "accueil", title: "Accueil", cols: "minmax(300px, 23%) 1fr minmax(320px, 24%)", bottom: true });
  const { page, left, center, right, bottom, tools } = shell;
  for (const [key, label] of [["micro", "Micro"], ["cameras", "Caméras"], ["doNotDisturb", "Calme"]] as const) {
    const b = el("button", "chip", `<i></i>${label}`);
    b.dataset.flag = key;
    b.onclick = () => api.send("jarvis:toggle", key);
    tools.prepend(b);
  }
  const guard = el("button", "chip hidden", "<i></i>Surveillance complète");
  guard.onclick = () => void api.invoke("securite:mode", "off");
  tools.prepend(guard);
  api.on("jarvis:flags", (f: { surveillance?: string }) => {
    guard.classList.toggle("hidden", f.surveillance !== "complete");
    guard.classList.toggle("danger", f.surveillance === "complete");
  });

  // Colonne gauche : date, rendez-vous, rappels
  const date = panel("Aujourd'hui", "", { icon: ICONS.calendar });
  const today = panel("Rendez-vous", "grow", { icon: ICONS.list });
  today.body.classList.add("timeline");
  const reminders = panel("Rappels", "", { icon: ICONS.bell, accent: "violet" });
  left.append(date.root, today.root, reminders.root);

  // Centre : Jarvis
  const size = () => (innerWidth <= 1280 ? Math.max(170, Math.min(innerHeight * 0.3, innerWidth * 0.42, 300)) : Math.max(260, Math.min(innerHeight * 0.46, innerWidth * 0.3, 470)));
  const reactorBox = createReactor(size, "J.A.R.V.I.S.");
  const reactor = reactorBox.querySelector<HTMLElement>(".reactor") ?? reactorBox;
  const status = reactorBox.querySelector(".reactor-label")!;
  const caption = el("div", "caption", '<div class="said"></div><div class="heard"></div>');
  const command = el("form", "command", `<button type="button" class="mic" title="Parler">${ICON.mic}</button><input placeholder="Demande à Jarvis… ou dis « Jarvis »"><kbd>Ctrl Alt Espace</kbd>`);
  const viewer = el("section", "panel viewer hidden", `<h4><span class="ic">${ICONS.eye}</span><span class="vt"></span><button class="close" title="Fermer">${ICON.close}</button></h4><div class="body"></div>`);
  viewer.dataset.accent = "violet";
  center.append(reactorBox, caption, command, viewer);

  // Colonne droite : météo, maison, en ce moment
  const weather = panel("Météo", "", { icon: ICONS.sun, accent: "gold" });
  const house = panel("Maison", "", { icon: ICONS.home, accent: "green" });
  const layouts = panel("Dispositions", "", { icon: ICONS.grid, link: false });
  layouts.body.classList.add("dispos");
  const now = panel("En ce moment", "", { icon: ICONS.pulse, link: false });
  now.root.style.flex = "1";
  house.root.classList.add("grow");
  house.body.style.overflowY = "auto";
  right.append(weather.root, house.root, layouts.root);

  // Bas : jauges du système et hexagones
  const sys = el("section", "panel sysrings");
  sys.dataset.accent = "green";
  bottom!.append(sys, now.root);
  bottom!.insertAdjacentHTML("beforeend", hexes());

  root.append(page);
  linkToReactor(page, reactor);

  // Date : anneau de la journée qui avance
  let alarm: Alarm | null = null;
  const renderDate = () => {
    const d = new Date();
    const progress = ((d.getHours() * 60 + d.getMinutes()) / 1440) * 100;
    const next = alarm?.prochain;
    const ringing = alarm?.phase === "sonne" || alarm?.phase === "repousse";
    const when = next ? (next.date === d.toISOString().slice(0, 10) ? "aujourd'hui" : new Date(`${next.date}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long" })) : "";
    date.body.innerHTML = `<div class="datecard">${gauge({ pct: progress, size: 118, stroke: 5, value: String(d.getDate()), label: d.toLocaleDateString("fr-FR", { month: "long" }), ticks: true, fontSize: 40, accent: "" })}
      <div class="txt"><b>${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</b><span>${d.toLocaleDateString("fr-FR", { weekday: "long" })} · ${d.getFullYear()}</span></div></div>
      ${ringing ? `<div class="alarm ringing">${ICONS.alarm}<span>Réveil : dis « je suis debout »</span></div>` : next ? `<div class="alarm">${ICONS.alarm}<b>${esc(next.heure)}</b><span>${esc(when)} · ${esc(next.raison)}</span><button data-skip="${esc(next.date)}" title="Pas de réveil ce jour-là">Passer</button></div>` : ""}`;
    date.body.querySelector<HTMLButtonElement>("[data-skip]")?.addEventListener("click", async (e) => {
      const day = (e.currentTarget as HTMLElement).dataset.skip!;
      alarm = await api.invoke<Alarm | null>("reveil:passer", { date: day, aucun: true });
      renderDate();
    });
  };
  renderDate();
  setInterval(renderDate, 20_000);

  // Commande écrite et micro
  const input = command.querySelector("input")!;
  command.addEventListener("submit", (e) => {
    e.preventDefault();
    if (input.value.trim()) api.send("input:text", input.value.trim());
    input.value = "";
  });
  command.querySelector<HTMLButtonElement>(".mic")!.onclick = () => api.send("jarvis:listen");

  // Ce que Jarvis dit et entend
  const said = caption.querySelector(".said")!;
  const heard = caption.querySelector(".heard")!;
  const STATUS: Record<string, string> = { veille: "En veille", ecoute: "Je t'écoute", reflexion: "Je réfléchis", parole: "Je parle" };
  const setStatus = (text: string) => (status.innerHTML = `J.A.R.V.I.S.<small>${esc(text)}</small>`);
  setStatus("En veille");
  api.on("jarvis:state", ({ state, detail }: { state: string; detail?: string }) => setStatus(detail ? `${STATUS[state]} · ${detail}` : STATUS[state] ?? ""));
  api.on("jarvis:partial", (text: string) => (said.textContent = lastSentences(text)));
  api.on("jarvis:message", ({ from, text }: { from: string; text: string }) => {
    if (from === "jarvis") said.textContent = lastSentences(text);
    else heard.textContent = `« ${text} »`;
  });
  api.on("jarvis:heard", ({ transcript, awake }: { transcript: string; awake: boolean }) => awake && (heard.textContent = `« ${transcript} »`));

  // Résultats affichés par Jarvis, par-dessus le centre
  let model: { rotate: (dx: number, dy: number) => void } | undefined;
  let grab: { x: number; y: number } | undefined;
  api.on("jarvis:panel", (payload: PanelPayload) => {
    viewer.classList.remove("hidden");
    viewer.querySelector(".vt")!.textContent = payload.titre;
    model = fillPanel(viewer.querySelector<HTMLElement>(".body")!, payload);
  });
  viewer.querySelector<HTMLButtonElement>(".close")!.onclick = () => {
    viewer.classList.add("hidden");
    viewer.querySelector(".body")!.replaceChildren();
    model = undefined;
  };
  onGesture((gesture, wrist) => {
    if (gesture !== "Closed_Fist" || !wrist || !model) return void (grab = undefined);
    if (grab) model.rotate((wrist.x - grab.x) * -6, (wrist.y - grab.y) * 6);
    grab = wrist;
  });

  // Données
  let state: HomeData | undefined;
  const notices: string[] = [];
  let running: HomeData["taches"] = [];
  const renderNow = () => {
    const items: Array<{ text: string; cls?: string }> = [];
    for (const t of running.slice(0, 2)) items.push({ text: `${t.titre}${t.etapes.length ? ` — ${t.etapes.at(-1)}` : " — en attente"}`, cls: "task" });
    if (state?.revisions) items.push({ text: `${state.revisions} fiche${state.revisions > 1 ? "s" : ""} de révision t'attend${state.revisions > 1 ? "ent" : ""}. Dis « on révise ».` });
    if (state?.race) items.push({ text: `${state.race.jeu === "LMU" ? "Le Mans Ultimate" : "F1"} en cours${state.race.piste ? ` à ${state.race.piste}` : ""}${state.race.position ? `, P${state.race.position}` : ""}. Dis « ouvre l'ingénieur ».`, cls: "warn" });
    for (const n of notices.slice(0, 3)) items.push({ text: n, cls: "danger" });
    if (state?.unread.length) items.push({ text: `${state.unread.length} mail${state.unread.length > 1 ? "s" : ""} non lu${state.unread.length > 1 ? "s" : ""} : ${state.unread.slice(0, 2).map((m) => m.subject).join(", ")}` });
    now.body.innerHTML = items.length ? items.map((i) => (i.cls === "task" ? `<div class="notice task"><span class="spin"></span><span>${esc(i.text)}</span></div>` : `<div class="notice ${i.cls ?? ""}"><i></i><span>${esc(i.text)}</span></div>`)).join("") : '<div class="empty">Rien à signaler.</div>';
  };

  const render = (data: HomeData) => {
    state = data;
    for (const b of tools.querySelectorAll<HTMLElement>("[data-flag]")) {
      const key = b.dataset.flag as keyof typeof flags;
      b.classList.toggle("off", key !== "doNotDisturb" && !data.flags[key]);
      b.classList.toggle("warn", key === "doNotDisturb" && data.flags.doNotDisturb);
    }
    const nowMs = Date.now();
    today.body.innerHTML = data.events.length
      ? data.events
          .map((e) => {
            const start = new Date(e.start).getTime();
            const end = new Date(e.end).getTime();
            const cls = !e.allDay && end < nowMs ? "past" : start <= nowMs && end >= nowMs ? "now" : "";
            return `<div class="row ${cls}"><span>${esc(e.summary)}</span><span class="v strong">${e.allDay ? "Journée" : hhmm(e.start)}</span></div>`;
          })
          .join("")
      : '<div class="empty">Aucun rendez-vous aujourd\'hui.</div>';
    reminders.body.innerHTML = data.rappels.length
      ? data.rappels.map((r) => `<div class="item"><span class="ic">${ICONS.bell}</span><span class="grow">${esc(r.texte)}</span><span class="v">${r.rappelLe ? hhmm(r.rappelLe) : ""}</span></div>`).join("")
      : '<div class="empty">Aucun rappel. Dis « rappelle-moi… ».</div>';
    house.body.replaceChildren();
    if (!data.devices.length) house.body.innerHTML = '<div class="empty">Aucun appareil connecté.</div>';
    for (const d of data.devices.slice(0, 5)) {
      const row = el("div", "item", `<span class="ic">${d.type === "prise" ? ICON.plug : ICON.bulb}</span><span class="grow">${esc(d.nom)}${d.allume && d.luminosite ? ` <span class="v">${d.luminosite} %</span>` : ""}</span>`);
      const sw = el("div", `switch${d.allume ? " on" : ""}`);
      sw.onclick = async () => {
        await api.invoke("tapo:toggle", { nom: d.nom, allume: !d.allume });
        void refresh();
      };
      row.append(sw);
      house.body.append(row);
    }
    alarm = data.reveil;
    running = data.taches ?? [];
    renderDate();
    layouts.body.replaceChildren();
    for (const d of data.dispositions ?? []) {
      const b = el("button", "", `${esc(d.nom)}<small>${d.pages.map((p) => esc(PAGE_NAMES[p.page] ?? p.page)).join(" · ")}</small>`);
      b.onclick = () => void api.invoke("disposition:appliquer", d.nom);
      layouts.body.append(b);
    }
    if (data.meteo) renderWeather(weather.body, data.meteo);
    else weather.body.innerHTML = '<div class="empty">Règle ta ville (JARVIS_VILLE) pour la météo.</div>';
    renderNow();
  };

  const renderSystem = (p: Perf) => {
    const g = p.gpu[0];
    const disk = p.disques[0];
    sys.innerHTML = [
      gauge({ pct: p.cpu.chargePct, size: 104, value: `${Math.round(p.cpu.chargePct)}%`, label: p.cpu.temperatureC ? `CPU ${Math.round(p.cpu.temperatureC)}°` : "CPU", fontSize: 20 }),
      gauge({ pct: g?.chargePct, size: 104, value: g?.chargePct !== undefined ? `${g.chargePct}%` : "—", label: g?.temperatureC ? `GPU ${g.temperatureC}°` : "GPU", fontSize: 20 }),
      gauge({ pct: p.memoire.pct, size: 104, value: `${Math.round(p.memoire.pct)}%`, label: "RAM", fontSize: 20 }),
      disk ? gauge({ pct: disk.utilisePct, size: 104, value: `${disk.utilisePct}%`, label: `Disque ${disk.lecteur}`, fontSize: 20 }) : "",
      gauge({ pct: Math.min(100, p.reseau.recuMbps), size: 104, value: `${p.reseau.recuMbps}`, label: "Mb/s", fontSize: 20, accent: "" }),
    ].join("");
  };

  const refresh = async () => render(await api.invoke<HomeData>("page:data", "accueil"));
  api.on("page:data", (data: HomeData) => data.events && render(data));
  api.on("meteo:data", (w: Weather) => renderWeather(weather.body, w));
  api.on("perf:data", renderSystem);
  api.on("reveil:etat", (status: Alarm) => {
    alarm = status;
    renderDate();
  });
  api.on("taches:data", (list: HomeData["taches"]) => {
    running = list;
    renderNow();
  });
  api.on("race:state", (race: HomeData["race"]) => {
    if (state) state.race = race;
    renderNow();
  });
  api.on("securite:evenement", (e: { camera: string; instant: string }) => {
    notices.unshift(`Mouvement : caméra ${e.camera} à ${hhmm(e.instant)}`);
    renderNow();
  });
  void refresh();

  // Les sens ne vivent que sur l'accueil.
  void startMicrophone().catch((error) => (heard.textContent = `Micro indisponible (${error instanceof Error ? error.message : error}). Vérifie Paramètres Windows → Confidentialité → Microphone.`));
  void startWebcams();
  watchWheel(
    () => state?.pttButton ?? null,
    (index) => state?.race && (heard.textContent = `Bouton ${index} du volant : mets BOUTON_VOLANT_PARLER=${index} dans les réglages pour en faire le bouton « parler ».`),
  );
}

function lastSentences(text: string): string {
  const clean = text.replace(/[*_#`>|]/g, "").replace(/^📻\s*/, "").trim();
  return clean.length > 220 ? `…${clean.slice(-220).replace(/^\S*\s/, "")}` : clean;
}

function renderWeather(body: HTMLElement, w: Weather): void {
  const icon = (name?: keyof typeof ICON) => (name && ICON[name]) || ICON.nuageux;
  body.innerHTML = `
    <div class="wnow">${icon(w.maintenant.icone)}<div class="t">${w.maintenant.temperature}°</div>
      <div class="d"><b style="color:var(--text)">${esc(w.ville)}</b><br>${esc(w.maintenant.libelle)}<br>ressenti ${w.maintenant.ressenti}° · vent ${w.maintenant.ventKmh} km/h</div></div>
    <div class="days">
      ${w.prochainesHeures.slice(0, 4).map((h) => `<div class="row"><span>${icon(h.icone)}${esc(h.heure)}</span><span class="v">${h.pluiePct} % · <b style="color:var(--text)">${h.temperature}°</b></span></div>`).join("")}
      <div class="row"><span>${icon("soleil")}Aujourd'hui</span><span class="v">${w.aujourdhui.min}° / ${w.aujourdhui.max}° · pluie ${w.aujourdhui.pluiePct} %</span></div>
      ${w.demain ? `<div class="row"><span>${icon(w.demain.icone)}Demain · ${esc(w.demain.libelle)}</span><span class="v">${w.demain.min}° / ${w.demain.max}°</span></div>` : ""}
    </div>`;
}
