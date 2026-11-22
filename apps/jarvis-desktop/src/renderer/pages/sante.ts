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

  // Onglets : bilan, composants, optimisations.
  const tabs = el("div", "health-tabs");
  const componentsBody = el("div", "scroll health-pane hidden");
  const tuningBody = el("div", "scroll health-pane hidden");
  list.body.after(componentsBody, tuningBody);
  list.body.before(tabs);
  const panes: Record<string, { body: HTMLElement; titre: string; load?: () => Promise<void>; loaded?: boolean }> = {
    bilan: { body: list.body, titre: "Constats et actions" },
    composants: { body: componentsBody, titre: "Composants du PC", load: () => loadComponents() },
    optimisations: { body: tuningBody, titre: "Optimisations", load: () => loadTuning() },
  };
  const showTab = (id: string) => {
    for (const [key, pane] of Object.entries(panes)) pane.body.classList.toggle("hidden", key !== id);
    tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.tab === id));
    list.title.querySelector("span:last-child")!.textContent = panes[id]!.titre;
    const pane = panes[id]!;
    if (pane.load && !pane.loaded) {
      pane.loaded = true;
      void pane.load();
    }
  };
  tabs.innerHTML = [["bilan", "Bilan"], ["composants", "Composants"], ["optimisations", "Optimisations"]].map(([id, label]) => `<button class="chip" data-tab="${id}">${label}</button>`).join("");
  tabs.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab!)));
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

  const confirmAction = (message: string) => window.confirm(message);
  const runAndReport = async (button: HTMLButtonElement, call: () => Promise<{ ok: boolean; message: string }>, after?: () => Promise<void>) => {
    button.disabled = true;
    say("En cours… (Windows peut demander une autorisation)");
    const r = await call();
    say(r.message, r.ok);
    button.disabled = false;
    if (after) await after();
  };

  interface Component { id: string; titre: string; etat: "ok" | "attention" | "erreur" | "inconnu"; mesures: Array<{ libelle: string; valeur: string; alerte?: boolean }>; constats: string[] }
  interface Proc { nom: string; id: number; memoireMo: number; fermable: boolean }
  const loadComponents = async () => {
    componentsBody.innerHTML = '<div class="empty">Lecture des composants (une vingtaine de secondes)…</div>';
    const r = await api.invoke<{ rapports: Component[]; processus: Proc[] }>("sante:composants");
    const stateClass = { ok: "ok", attention: "attention", erreur: "erreur", inconnu: "absent" } as const;
    componentsBody.innerHTML =
      `<div class="health-refresh"><button class="health-button" data-reload>Actualiser</button></div>` +
      r.rapports
        .map((c) => `<div class="check ${stateClass[c.etat]} component"><h5><i></i>${esc(c.titre)}</h5>${c.mesures.map((m) => `<div class="row"><span>${esc(m.libelle)}</span><span class="v ${m.alerte ? "bad" : ""}">${esc(m.valeur)}</span></div>`).join("")}${c.constats.map((t) => `<p class="tip">${esc(t)}</p>`).join("")}</div>`)
        .join("") +
      `<div class="check absent component"><h5><i></i>Programmes les plus gourmands en mémoire</h5>${r.processus.map((p) => `<div class="row"><span>${esc(p.nom)}</span><span class="v">${(p.memoireMo / 1024).toFixed(1).replace(".", ",")} Go ${p.fermable ? `<button class="health-button small" data-close="${p.id}" data-name="${esc(p.nom)}">Fermer</button>` : ""}</span></div>`).join("")}</div>`;
    componentsBody.querySelector<HTMLButtonElement>("[data-reload]")!.onclick = () => void loadComponents();
    componentsBody.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((b) => {
      b.onclick = () => {
        if (!confirmAction(`Fermer ${b.dataset.name} ? Un travail non enregistré dans ce programme serait perdu.`)) return;
        void runAndReport(b, () => api.invoke("sante:fermer", { id: Number(b.dataset.close), nom: b.dataset.name }), loadComponents);
      };
    });
  };

  interface TuningItem { id: string; titre: string; description: string; categorie: string; actif: boolean | null; admin: boolean; redemarrage: boolean; ponctuel: boolean; annulable: boolean }
  interface Startup { nom: string; commande: string; ruche: string; actif: boolean }
  const loadTuning = async () => {
    tuningBody.innerHTML = '<div class="empty">Lecture des réglages de Windows…</div>';
    const st = await api.invoke<{ reglages: TuningItem[]; demarrage: Startup[]; fichierEchangeAuto: boolean | null }>("sante:optimisations");
    const badge = (t: TuningItem) => (t.ponctuel ? "" : t.actif ? '<span class="tag ok">déjà fait</span>' : '<span class="tag">pas encore</span>');
    const notes = (t: TuningItem) => [t.admin ? "autorisation Windows" : "", t.redemarrage ? "redémarrage" : ""].filter(Boolean).join(" · ");
    const groups = new Map<string, TuningItem[]>();
    for (const t of st.reglages) groups.set(t.categorie, [...(groups.get(t.categorie) ?? []), t]);
    const power = `<div class="check absent component"><h5><i></i>Puissance et alimentation</h5>
      <p>Plan d'alimentation et test de la carte graphique (la limite s'annule au redémarrage du PC).</p>
      <div class="health-actions"><button class="health-button" data-health="plan-performances">Plan « Performances élevées »</button>
      <button class="health-button" data-health="plan-equilibre">Plan « Utilisation normale »</button>
      <button class="health-button" data-health="limite-gpu">Limiter la carte graphique à 80 %</button>
      <button class="health-button" data-health="limite-gpu-defaut">Puissance normale</button>
      <button class="health-button" data-health="nettoyer-temp">Nettoyer les fichiers temporaires</button></div></div>`;
    const pagefile = st.fichierEchangeAuto === false ? `<div class="check attention component"><h5><i></i>Fichier d'échange réglé à la main</h5><p>Avec 16 Go de mémoire, un fichier d'échange trop petit peut faire planter les jeux. Le plus sûr : le laisser à Windows.</p><small>autorisation Windows · redémarrage</small><br><button class="health-button" data-tweak="fichier-echange-auto">Laisser Windows le gérer</button></div>` : "";
    tuningBody.innerHTML =
      `<p class="lead">Réglages reconnus et sans danger. Chaque changement est noté dans le Journal et peut être annulé. Avant ceux qui demandent l'autorisation Windows, crée un point de restauration (Entretien).</p>` +
      power +
      pagefile +
      [...groups.entries()]
        .map(([cat, items]) => `<h6 class="health-cat">${esc(cat)}</h6>` + items.map((t) => `<div class="check ${t.actif ? "ok" : "absent"} component"><h5><i></i>${esc(t.titre)} ${badge(t)}</h5><p>${esc(t.description)}</p>${notes(t) ? `<small>${esc(notes(t))}</small><br>` : ""}${!t.actif || t.ponctuel ? `<button class="health-button" data-tweak="${t.id}" data-admin="${t.admin}">${t.ponctuel ? "Lancer" : "Appliquer"}</button>` : ""}${t.annulable ? `<button class="health-button" data-undo="${t.id}">Annuler</button>` : ""}</div>`).join(""))
        .join("") +
      `<h6 class="health-cat">Programmes au démarrage de Windows</h6><div class="check absent component">${st.demarrage.length ? st.demarrage.map((e) => `<div class="row"><span>${esc(e.nom)}${e.ruche === "HKLM" ? " <small>(tous les comptes)</small>" : ""}</span><span class="v">${e.actif ? "se lance" : "désactivé"} <button class="health-button small" data-startup="${esc(e.nom)}" data-on="${!e.actif}">${e.actif ? "Désactiver" : "Réactiver"}</button></span></div>`).join("") : '<div class="empty">Aucun.</div>'}</div>`;
    tuningBody.querySelectorAll<HTMLButtonElement>("[data-health]").forEach((b) => (b.onclick = () => void runAndReport(b, () => api.invoke("sante:action", b.dataset.health))));
    tuningBody.querySelectorAll<HTMLButtonElement>("[data-tweak]").forEach((b) => (b.onclick = () => void runAndReport(b, () => api.invoke("sante:optimiser", { id: b.dataset.tweak }), loadTuning)));
    tuningBody.querySelectorAll<HTMLButtonElement>("[data-undo]").forEach((b) => (b.onclick = () => void runAndReport(b, () => api.invoke("sante:optimiser", { id: b.dataset.undo, annuler: true }), loadTuning)));
    tuningBody.querySelectorAll<HTMLButtonElement>("[data-startup]").forEach((b) => (b.onclick = () => void runAndReport(b, () => api.invoke("sante:demarrage", { nom: b.dataset.startup, actif: b.dataset.on === "true" }), loadTuning)));
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
  showTab("bilan");
  void load();
}
