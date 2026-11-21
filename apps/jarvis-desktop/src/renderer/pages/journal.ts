import { api, el, esc, panel } from "../common.js";
import { buildPage, ICONS } from "../hud.js";

interface Entry { t: string; outil: string; resume: string; autorise: boolean; raison?: string; origine?: string }
interface JournalData { jours: string[]; jour: string; entrees: Entry[]; erreurs: Array<{ t: string; texte: string }>; enPanne: string[] }

type Filter = "tout" | "alertes" | "refus" | "auto" | "moi";
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "tout", label: "Tout" },
  { id: "moi", label: "Mes demandes" },
  { id: "auto", label: "Automatique" },
  { id: "alertes", label: "Alertes" },
  { id: "refus", label: "Refusé" },
];

const ALERT_TOOLS = /veilleur|surveillance|securite|alerte|telephone/i;

function matches(e: Entry, f: Filter): boolean {
  if (f === "tout") return true;
  if (f === "refus") return !e.autorise;
  if (f === "alertes") return ALERT_TOOLS.test(e.outil);
  if (f === "auto") return e.origine === "automatique";
  return e.origine !== "automatique";
}

function label(day: string): string {
  const today = new Date();
  const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  if (day === iso(today)) return "Aujourd'hui";
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (day === iso(y)) return "Hier";
  return new Date(`${day}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

/** Journal : ce que Jarvis a fait, quand, pour qui, et ce qu'il a refusé. */
export function renderJournal(root: HTMLElement): void {
  const { page, left, center, right, tools } = buildPage({ id: "journal", title: "Journal", cols: "minmax(220px, 18%) 1fr minmax(260px, 22%)" });
  const refresh = el("button", "chip", "<i></i>Actualiser");
  tools.prepend(refresh);

  const days = panel("Jours", "grow", { icon: ICONS.calendar });
  left.append(days.root);
  const list = panel("Ce que j'ai fait", "grow", { icon: ICONS.list, link: false });
  const chips = el("div", "journal-filters");
  list.body.before(chips);
  center.append(list.root);
  const summary = panel("En bref", "", { icon: ICONS.health, accent: "green" });
  const errors = panel("Erreurs récentes", "grow", { icon: ICONS.bell, accent: "red" });
  right.append(summary.root, errors.root);
  root.append(page);

  let data: JournalData | undefined;
  let filter: Filter = "tout";

  const draw = () => {
    if (!data) return;
    days.body.innerHTML = data.jours.length
      ? data.jours.map((d) => `<button class="journal-day ${d === data!.jour ? "on" : ""}" data-day="${d}">${esc(label(d))}</button>`).join("")
      : '<div class="empty">Rien encore.</div>';
    days.body.querySelectorAll<HTMLButtonElement>("[data-day]").forEach((b) => (b.onclick = () => void load(b.dataset.day)));
    chips.innerHTML = FILTERS.map((f) => `<button class="chip ${f.id === filter ? "on" : ""}" data-f="${f.id}">${esc(f.label)} <small>${data!.entrees.filter((e) => matches(e, f.id)).length}</small></button>`).join("");
    chips.querySelectorAll<HTMLButtonElement>("[data-f]").forEach((b) => (b.onclick = () => ((filter = b.dataset.f as Filter), draw())));
    const shown = data.entrees.filter((e) => matches(e, filter));
    list.body.innerHTML = shown.length
      ? shown
          .map((e) => {
            const time = new Date(e.t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
            const who = e.origine === "automatique" ? "auto" : e.origine?.includes("inconnu") ? "voix inconnue" : e.origine ?? "toi";
            return `<div class="journal-entry ${e.autorise ? "" : "refused"} ${ALERT_TOOLS.test(e.outil) ? "alert" : ""}"><time>${time}</time><span class="tool">${esc(e.outil)}</span><span class="what">${esc(e.resume)}${e.raison ? `<em>${esc(e.raison)}</em>` : ""}</span><span class="who">${esc(who)}</span></div>`;
          })
          .join("")
      : '<div class="empty">Rien pour ce filtre.</div>';
    const auto = data.entrees.filter((e) => e.origine === "automatique").length;
    const refused = data.entrees.filter((e) => !e.autorise).length;
    summary.body.innerHTML = `<div class="row"><span>Actions</span><span class="v strong">${data.entrees.length}</span></div><div class="row"><span>Automatiques</span><span class="v">${auto}</span></div><div class="row"><span>Refusées</span><span class="v ${refused ? "bad" : ""}">${refused}</span></div><div class="row"><span>Éléments en panne</span><span class="v ${data.enPanne.length ? "bad" : ""}">${data.enPanne.length ? esc(data.enPanne.join(", ")) : "aucun"}</span></div>`;
    errors.body.innerHTML = data.erreurs.length
      ? data.erreurs.map((e) => `<div class="journal-error"><time>${esc(new Date(e.t).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))}</time><pre>${esc(e.texte.split("\n").slice(0, 4).join("\n"))}</pre></div>`).join("")
      : '<div class="empty">Aucune erreur enregistrée.</div>';
  };

  const load = async (day?: string) => {
    data = await api.invoke<JournalData>("journal:lire", day);
    draw();
  };
  refresh.onclick = () => void load(data?.jour);
  // Actualisation discrète quand la page est visible.
  setInterval(() => document.visibilityState === "visible" && data && data.jour === data.jours[0] && void load(data.jour), 30_000);
  void load();
}
