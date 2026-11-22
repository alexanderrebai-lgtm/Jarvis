import { api, el, esc, panel } from "../common.js";
import { buildPage, ICONS } from "../hud.js";

type Severity = "critique" | "attention" | "info" | "ok";
interface Finding { id: string; gravite: Severity; titre: string; detail: string; conseil?: string; actions?: Array<{ id: string; libelle: string }> }
interface Nvidia { nom: string; pilote: string; tempC?: number; puissanceW?: number; limiteW?: number; limiteDefautW?: number; ventilateurPct?: number; memoireUtiliseeMo?: number; memoireTotaleMo?: number }
interface Health {
  raw: {
    windows?: string;
    carteMere?: string;
    bios?: { version?: string; date?: string };
    arretsBrutaux: Array<{ date: string; bugcheck: number }>;
    erreursMaterielles: unknown[];
    plantagesPilote: string[];
    nvidia?: Nvidia;
    relevesJeu: Array<{ instant: string; tempC?: number; puissanceW?: number }>;
  };
  constats: Finding[];
  date: string;
  machine: string;
  alimentation: string | null;
  enJeu: boolean;
}

const LABEL: Record<Severity, string> = { critique: "Important", attention: "À surveiller", info: "Conseil", ok: "En ordre" };
const STATE: Record<Severity, string> = { critique: "erreur", attention: "attention", info: "absent", ok: "ok" };
const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Santé du PC : arrêts brutaux, carte graphique, réglages, recherche de solutions en ligne, rapport. */
export function renderHealth(root: HTMLElement): void {
  const { page, left, center, right, tools } = buildPage({ id: "sante", title: "Santé du PC", cols: "minmax(270px, 22%) 1fr minmax(300px, 27%)" });
  const rerun = el("button", "chip", "<i></i>Refaire le bilan");
  const report = el("button", "chip", "<i></i>Rapport");
  tools.prepend(report, rerun);

  const summary = panel("Bilan", "", { icon: ICONS.health });
  const gpu = panel("Carte graphique", "", { icon: ICONS.gpu, accent: "violet" });
  const cuts = panel("Arrêts (30 jours)", "grow", { icon: ICONS.bell, accent: "red" });
  left.append(summary.root, gpu.root, cuts.root);
  const list = panel("Constats et actions", "grow", { icon: ICONS.list, link: false });
  list.body.classList.add("checks");
  center.append(list.root);
  const web = panel("Solutions trouvées sur Internet", "grow", { icon: ICONS.book, accent: "gold" });
  right.append(web.root);
  root.append(page);

  const status = el("div", "status health-status");
  list.root.append(status);
  const say = (text: string, ok = true) => {
    status.className = `status health-status ${ok ? "ok" : "bad"}`;
    status.textContent = text;
  };

  const actionButtons = (actions: Finding["actions"] = []) => actions.map((a) => `<button class="health-button" data-action="${esc(a.id)}">${esc(a.libelle)}</button>`).join("");
  const bindActions = (container: HTMLElement) =>
    container.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        say("En cours… (Windows peut demander une autorisation)");
        const r = await api.invoke<{ ok: boolean; message: string }>("sante:action", b.dataset.action);
        say(r.message, r.ok);
        b.disabled = false;
      };
    });

  const render = (h: Health) => {
    const counts = { critique: 0, attention: 0, info: 0, ok: 0 };
    for (const c of h.constats) counts[c.gravite] += 1;
    summary.body.innerHTML = `<p class="health-machine">${esc(h.machine)}</p>
      ${h.raw.windows ? `<div class="row"><span>Windows</span><span class="v">${esc(h.raw.windows)}</span></div>` : ""}
      ${h.raw.carteMere ? `<div class="row"><span>Carte mère</span><span class="v">${esc(h.raw.carteMere)}${h.raw.bios?.date ? ` · BIOS ${esc(h.raw.bios.date)}` : ""}</span></div>` : ""}
      <div class="row"><span>Alimentation</span><span class="v ${h.alimentation ? "" : "bad"}">${esc(h.alimentation ?? "à renseigner (Réglages)")}</span></div>
      <div class="row"><span>Important</span><span class="v ${counts.critique ? "bad" : ""}">${counts.critique}</span></div>
      <div class="row"><span>À surveiller</span><span class="v">${counts.attention}</span></div>
      <div class="row"><span>Bilan du</span><span class="v">${esc(when(h.date))}</span></div>`;
    const g = h.raw.nvidia;
    const maxGame = h.raw.relevesJeu.reduce((m, s) => Math.max(m, s.tempC ?? 0), 0);
    gpu.body.innerHTML = g
      ? `<div class="row"><span>${esc(g.nom)}</span></div>
        <div class="row"><span>Température</span><span class="v ${g.tempC !== undefined && g.tempC >= 83 ? "bad" : ""}">${g.tempC ?? "—"} °C</span></div>
        <div class="row"><span>Puissance</span><span class="v">${g.puissanceW !== undefined ? Math.round(g.puissanceW) : "—"} W / ${g.limiteW !== undefined ? Math.round(g.limiteW) : "—"} W</span></div>
        <div class="row"><span>Ventilateur</span><span class="v">${g.ventilateurPct ?? "—"} %</span></div>
        <div class="row"><span>Pilote</span><span class="v">${esc(g.pilote)}</span></div>
        <div class="row"><span>Max en jeu (30 j)</span><span class="v ${maxGame >= 83 ? "bad" : ""}">${maxGame ? `${maxGame} °C` : "pas encore de relevé"}</span></div>`
      : '<div class="empty">Carte NVIDIA non détectée (nvidia-smi absent).</div>';
    cuts.body.innerHTML = h.raw.arretsBrutaux.length
      ? h.raw.arretsBrutaux.map((a) => `<div class="item"><span class="grow">${esc(when(a.date))}</span><span class="v ${a.bugcheck === 0 ? "bad" : ""}">${a.bugcheck === 0 ? "coupure" : `écran bleu 0x${a.bugcheck.toString(16).toUpperCase()}`}</span></div>`).join("")
      : '<div class="empty">Aucun arrêt brutal.</div>';
    list.body.innerHTML = h.constats
      .map((c) => `<div class="check ${STATE[c.gravite]}"><small>${LABEL[c.gravite]}</small><h5><i></i>${esc(c.titre)}</h5><p>${esc(c.detail)}</p>${c.conseil ? `<p class="tip">${esc(c.conseil)}</p>` : ""}${actionButtons(c.actions)}</div>`)
      .join("");
    bindActions(list.body);
  };

  web.body.innerHTML = `<p class="lead">Jarvis cherche sur Internet les causes et réglages connus pour ton matériel et tes symptômes, puis te propose des actions. Rien n'est modifié sans ton clic.</p>`;
  const search = el("button", "health-button", "Chercher des solutions sur Internet");
  const webOut = el("div", "health-web");
  web.body.append(search, webOut);
  search.onclick = async () => {
    search.disabled = true;
    webOut.innerHTML = '<div class="empty">Recherche en cours (une à deux minutes)…</div>';
    const r = await api.invoke<{ ok: boolean; texte: string; actions: Array<{ id: string; libelle: string }> }>("sante:web");
    webOut.innerHTML = `<div class="health-text">${esc(r.texte).replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank">$1</a>')}</div>${r.actions.length ? `<div class="health-actions">${actionButtons(r.actions)}</div>` : ""}`;
    bindActions(webOut);
    search.disabled = false;
  };

  const load = async (refresh = false) => {
    list.body.innerHTML = '<div class="empty">Bilan en cours (lecture des journaux de Windows, une vingtaine de secondes)…</div>';
    render(await api.invoke<Health>("sante:bilan", refresh));
  };
  rerun.onclick = () => void load(true);
  report.onclick = async () => {
    const file = await api.invoke<string | null>("sante:rapport");
    say(file ? `Rapport enregistré : ${file}` : "Fais d'abord un bilan.", Boolean(file));
  };
  void load();
}
