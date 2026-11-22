import { api, el, esc, panel } from "../common.js";
import { buildPage, ICONS } from "../hud.js";

interface Entree { appels: number; usd: number; entree: number; sortie: number }
interface Resume {
  aujourdhui: Entree;
  mois: Entree;
  jours: Array<{ jour: string } & Entree>;
  parSource: Array<{ source: string } & Entree>;
}
interface Donnees { resume: Resume; plafond: number | null; pauseAuto: boolean; mode: "cle-api" | "abonnement" }

const usd = (n: number) => `${n.toFixed(2)} $`;
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} k` : String(n));

/** Coût : combien Jarvis consomme de Claude, et quelles tâches automatiques pèsent le plus. */
export function renderCout(root: HTMLElement): void {
  const { page, left, center, right, tools } = buildPage({ id: "cout", title: "Coût de Claude", cols: "minmax(260px, 24%) 1fr minmax(300px, 30%)" });
  const refresh = el("button", "chip", "<i></i>Actualiser");
  tools.prepend(refresh);

  const info = panel("Comment lire ça", "", { icon: ICONS.book });
  left.append(info.root);
  const now = panel("Aujourd'hui", "", { icon: ICONS.pulse, link: false });
  const days = panel("30 derniers jours", "grow", { icon: ICONS.list, link: false });
  center.append(now.root, days.root);
  const sources = panel("Ce qui consomme", "grow", { icon: ICONS.note, accent: "gold" });
  right.append(sources.root);
  root.append(page);

  const draw = (d: Donnees) => {
    info.body.innerHTML = d.mode === "cle-api"
      ? `<p class="lead">Tu utilises une <b>clé API</b> : ces montants sont ce que Claude te facture réellement.</p><p class="lead">Les tâches que Jarvis fait <b>tout seul</b> (surveillance d'écran, briefings, mails importants) consomment en continu : c'est souvent là que ça part.</p>`
      : `<p class="lead">Tu utilises ton <b>abonnement Claude</b> : rien n'est facturé à l'appel, ces montants sont un <b>équivalent en dollars</b>. Ce qui compte, c'est le nombre d'appels, qui entre dans ta limite d'utilisation.</p><p class="lead">Les tâches que Jarvis fait <b>tout seul</b> (surveillance d'écran, briefings, mails importants) consomment en continu.</p>`;
    info.body.innerHTML += `<p class="tip">Plafond du jour : ${d.plafond ? `<b>${usd(d.plafond)}</b>${d.pauseAuto ? " — au-delà, les tâches automatiques se mettent en pause jusqu'à demain" : " (alerte seulement)"}` : "aucun. Règle-le dans Réglages → Coût de Claude."}</p>`;

    const part = d.plafond ? Math.min(1, d.resume.aujourdhui.usd / d.plafond) : 0;
    now.body.innerHTML = `<div class="forme-grid">
      <div class="forme-tuile"><div class="v">${d.resume.aujourdhui.appels}</div><div class="l">appels aujourd'hui</div></div>
      <div class="forme-tuile"><div class="v">${esc(usd(d.resume.aujourdhui.usd))}</div><div class="l">équivalent du jour</div></div>
      <div class="forme-tuile"><div class="v">${d.resume.mois.appels}</div><div class="l">appels ce mois-ci</div><small>${esc(usd(d.resume.mois.usd))}</small></div>
      <div class="forme-tuile"><div class="v">${esc(k(d.resume.aujourdhui.entree + d.resume.aujourdhui.sortie))}</div><div class="l">jetons aujourd'hui</div></div>
    </div>${d.plafond ? `<div class="cout-jauge" title="${Math.round(part * 100)} % du plafond"><i style="width:${Math.round(part * 100)}%" class="${part >= 1 ? "bad" : part >= 0.8 ? "warn" : ""}"></i></div>` : ""}`;

    const max = Math.max(0.0001, ...d.resume.jours.map((j) => j.usd));
    days.body.innerHTML = d.resume.jours.some((j) => j.appels)
      ? `<div class="cout-barres">${d.resume.jours.map((j) => `<div class="b" title="${esc(j.jour)} : ${j.appels} appel(s), ${esc(usd(j.usd))}"><i style="height:${Math.max(j.appels ? 4 : 0, Math.round((j.usd / max) * 100))}%"></i></div>`).join("")}</div><small class="muted">Du plus ancien (à gauche) à aujourd'hui.</small>`
      : `<div class="empty">Pas encore de données : le compteur démarre avec cette version.</div>`;

    sources.body.innerHTML = d.resume.parSource.length
      ? `<table class="cout-table"><thead><tr><th>Source</th><th>Appels</th><th>Équiv.</th></tr></thead><tbody>${d.resume.parSource.map((s) => `<tr><td>${esc(s.source)}</td><td>${s.appels}</td><td>${esc(usd(s.usd))}</td></tr>`).join("")}</tbody></table>`
      : `<div class="empty">Rien pour l'instant.</div>`;
  };

  const load = async () => draw(await api.invoke<Donnees>("cout:lire"));
  refresh.onclick = () => void load();
  setInterval(() => document.visibilityState === "visible" && void load(), 30_000);
  void load();
}
