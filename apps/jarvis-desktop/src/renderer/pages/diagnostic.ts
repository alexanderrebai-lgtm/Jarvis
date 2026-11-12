import { api, el, esc, panel } from "../common.js";
import { buildPage, createReactor, ICONS, linkToReactor } from "../hud.js";

interface Check {
  id: string;
  groupe: string;
  titre: string;
  etat: "ok" | "attention" | "erreur" | "absent";
  detail: string;
  conseil?: string;
  action?: { libelle: string; commande?: string; reglages?: string };
}

const STATE_LABEL: Record<Check["etat"], string> = { ok: "En ordre", attention: "À surveiller", erreur: "Problème", absent: "Non configuré" };

/** Bilan de santé de Jarvis : chaque organe, son état, et quoi faire. */
export function renderDiagnostic(root: HTMLElement): void {
  const { page, left, center, right, tools } = buildPage({ id: "diagnostic", title: "Diagnostic", cols: "minmax(260px, 20%) 1fr minmax(260px, 20%)" });
  const rerun = el("button", "chip", "<i></i>Relancer");
  const toSettings = el("button", "chip", "<i></i>Réglages");
  toSettings.onclick = () => api.send("page:open", "reglages");
  tools.prepend(toSettings, rerun);

  const summary = panel("Bilan", "", { icon: ICONS.health });
  const legend = panel("Légende", "", { icon: ICONS.list, accent: "violet" });
  legend.body.innerHTML = (["ok", "attention", "erreur", "absent"] as const).map((s) => `<div class="check ${s}" style="padding:6px 10px"><h5><i></i>${STATE_LABEL[s]}</h5></div>`).join("");
  left.append(summary.root, legend.root);

  const reactor = createReactor(() => Math.max(150, Math.min(innerHeight * 0.22, 210)), "J.A.R.V.I.S.");
  const list = panel("Mes systèmes", "grow", { icon: ICONS.cpu, link: false });
  list.body.classList.add("checks");
  center.append(reactor, list.root);

  const advice = panel("À faire", "grow", { icon: ICONS.bell, accent: "gold" });
  right.append(advice.root);
  root.append(page);
  linkToReactor(page, reactor.querySelector<HTMLElement>(".reactor") ?? reactor);

  const render = (results: Check[], version?: string) => {
    const counts = { ok: 0, attention: 0, erreur: 0, absent: 0 };
    for (const r of results) counts[r.etat] += 1;
    summary.body.innerHTML = `<div class="row"><span>En ordre</span><span class="v strong">${counts.ok}</span></div><div class="row"><span>À surveiller</span><span class="v">${counts.attention}</span></div><div class="row"><span>Problèmes</span><span class="v">${counts.erreur}</span></div><div class="row"><span>Non configurés</span><span class="v">${counts.absent}</span></div>${version ? `<div class="row"><span>Version</span><span class="v">${esc(version)}</span></div>` : ""}`;
    const groups = new Map<string, Check[]>();
    for (const r of results) groups.set(r.groupe, [...(groups.get(r.groupe) ?? []), r]);
    list.body.innerHTML = [...groups.entries()]
      .flatMap(([groupe, checks]) =>
        checks.map(
          (c) =>
            `<div class="check ${c.etat}"><small>${esc(groupe)}</small><h5><i></i>${esc(c.titre)}</h5><p>${esc(c.detail)}</p>${c.conseil ? `<p class="tip">${esc(c.conseil)}</p>` : ""}${c.action ? `<button ${c.action.reglages ? `data-set="${esc(c.action.reglages)}"` : `data-cmd="${esc(c.action.commande ?? "")}"`}>${esc(c.action.libelle)}</button>` : ""}</div>`,
        ),
      )
      .join("");
    const todo = results.filter((r) => (r.etat === "erreur" || r.etat === "attention") && (r.conseil || r.action));
    advice.body.innerHTML = todo.length ? todo.map((r) => `<div class="item"><span class="grow"><b>${esc(r.titre)}</b><br><span class="v">${esc(r.conseil ?? r.action?.libelle ?? "")}</span></span></div>`).join("") : '<div class="empty">Rien d\'urgent.</div>';
    list.body.querySelectorAll<HTMLButtonElement>("[data-cmd]").forEach((b) => (b.onclick = () => api.send("input:text", b.dataset.cmd)));
    list.body.querySelectorAll<HTMLButtonElement>("[data-set]").forEach((b) => (b.onclick = () => api.send("reglages:ouvrir", b.dataset.set)));
  };

  const run = async () => {
    list.body.innerHTML = '<div class="empty">Vérification en cours…</div>';
    const r = await api.invoke<{ resultats: Check[]; version: string }>("diagnostic:run");
    render(r.resultats, r.version);
  };
  rerun.onclick = () => void run();
  api.on("page:data", (data: { resultats?: Check[] | null; version?: string }) => data.resultats && render(data.resultats, data.version));
  void run();
}
