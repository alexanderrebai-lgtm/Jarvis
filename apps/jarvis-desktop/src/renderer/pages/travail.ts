import { api, el, esc, fillPanel, hhmm, ICON, panel, type PanelPayload } from "../common.js";
import { buildPage, createReactor, ICONS, linkToReactor } from "../hud.js";

interface WorkData {
  events: Array<{ summary: string; start: string; allDay: boolean; location: string }>;
  unread: Array<{ from: string; subject: string }>;
  notes: Array<{ texte: string }>;
  rappels: Array<{ texte: string; rappelLe?: string }>;
}

export function renderWork(root: HTMLElement): void {
  const { page, left, center, right } = buildPage({ id: "travail", title: "Travail", cols: "minmax(290px, 22%) 1fr minmax(290px, 22%)" });
  const agenda = panel("Agenda du jour", "grow", { icon: ICONS.calendar });
  agenda.body.classList.add("timeline");
  const mails = panel("Mails non lus", "", { icon: ICONS.mail, accent: "gold" });
  left.append(agenda.root, mails.root);

  const reactor = createReactor(Math.round(Math.min(innerHeight * 0.26, 240)), "J.A.R.V.I.S.");
  const board = el("div", "board scroll");
  const hint = panel("Espace de travail", "", { icon: ICONS.team, accent: "violet", link: false });
  hint.body.innerHTML = '<div class="empty" style="font-size:14.5px;line-height:1.8">Demande-moi ce dont tu as besoin, je l\'affiche ici :<br>« Fais le bilan de l\'équipe à partir de l\'export Excel de la semaine »<br>« Prépare le planning de décembre avec les congés »<br>« Prépare l\'entretien de Karim »<br>« Rédige le script d\'accueil pour la nouvelle offre »</div>';
  board.append(hint.root);
  center.append(reactor, board);

  const reminders = panel("Rappels", "", { icon: ICONS.bell, accent: "violet" });
  const notes = panel("Notes", "grow", { icon: ICONS.note, accent: "green" });
  right.append(reminders.root, notes.root);
  root.append(page);
  linkToReactor(page, reactor.querySelector<HTMLElement>(".reactor")!);

  // Chaque résultat de Jarvis arrive en haut de l'espace de travail ; on garde les quatre derniers.
  api.on("jarvis:panel", (payload: PanelPayload) => {
    hint.root.remove();
    const card = panel(payload.titre, "", { icon: ICONS.work, accent: "violet", link: false });
    const close = el("button", "close", ICON.close);
    close.onclick = () => card.root.remove();
    card.title.append(close);
    fillPanel(card.body, payload);
    board.prepend(card.root);
    while (board.children.length > 4) board.lastChild?.remove();
  });

  const render = (d: WorkData) => {
    agenda.body.innerHTML = d.events.length
      ? d.events.map((e) => `<div class="row"><span>${esc(e.summary)}</span><span class="v strong">${e.allDay ? "Journée" : hhmm(e.start)}</span></div>`).join("")
      : '<div class="empty">Agenda libre aujourd\'hui.</div>';
    mails.body.innerHTML = d.unread.length
      ? d.unread.map((m) => `<div class="item"><span class="ic">${ICONS.mail}</span><span class="grow">${esc(m.subject || "(sans objet)")}</span><span class="v">${esc(m.from)}</span></div>`).join("")
      : '<div class="empty">Boîte de réception à jour.</div>';
    reminders.body.innerHTML = d.rappels.length ? d.rappels.map((r) => `<div class="item"><span class="ic">${ICONS.bell}</span><span class="grow">${esc(r.texte)}</span><span class="v">${r.rappelLe ? hhmm(r.rappelLe) : ""}</span></div>`).join("") : '<div class="empty">Aucun rappel.</div>';
    notes.body.innerHTML = d.notes.length ? d.notes.map((n) => `<div class="item"><span class="ic">${ICONS.note}</span><span class="grow">${esc(n.texte)}</span></div>`).join("") : '<div class="empty">Aucune note.</div>';
  };
  void api.invoke<WorkData>("page:data", "travail").then(render);
  setInterval(() => void api.invoke<WorkData>("page:data", "travail").then(render), 60_000);
}
