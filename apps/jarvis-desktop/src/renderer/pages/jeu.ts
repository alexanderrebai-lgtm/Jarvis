import { api, el, esc, panel } from "../common.js";
import { buildPage, ICONS } from "../hud.js";

interface Action { libelle: string; question: string; ecran?: boolean }
interface Profil { genre: string; libelle: string; accroche: string; actions: Action[]; histoire: boolean }
interface Jeu { nom: string; genre: string; source: string; lanceur?: string; minutes?: number }
interface Note { id: string; texte: string; date: string }
interface Etat {
  actuel: Jeu | null;
  autres: Jeu[];
  profil: Profil | null;
  notes: Note[];
  recents: Array<{ jeu: string; genre: string; minutes: number; dernier: string }>;
  manuel: boolean;
  genres: Array<{ genre: string; libelle: string }>;
  ecranSecondaire: boolean;
}

const duree = (m: number) => (m < 1 ? "moins d'une minute" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`);
const jour = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const SOURCES: Record<string, string> = { catalogue: "reconnu par son nom", dossier: "reconnu par son dossier d'installation", perso: "ajouté par toi", manuel: "indiqué à la main" };

/** Joli rendu d'une réponse Markdown courte (gras, listes), sans HTML venu de l'extérieur. */
function markdown(texte: string): string {
  return esc(texte)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/^\s*[-•]\s+(.*)$/gm, "• $1")
    .replace(/\n/g, "<br>");
}

/** Compagnon de jeu : la page s'adapte au genre du jeu que Jarvis a détecté tout seul. */
export function renderJeu(root: HTMLElement): void {
  const { page, left, center, right, tools } = buildPage({ id: "jeu", title: "Compagnon de jeu", cols: "minmax(260px, 24%) 1fr minmax(280px, 28%)" });
  const refresh = el("button", "chip", "<i></i>Actualiser");
  tools.prepend(refresh);

  const jeu = panel("Jeu en cours", "", { icon: ICONS.pulse, link: false });
  const histo = panel("Joué récemment", "", { icon: ICONS.list, link: false });
  left.append(jeu.root, histo.root);
  const coach = panel("Coach", "grow", { icon: ICONS.book, accent: "green", link: false });
  center.append(coach.root);
  center.style.alignItems = "stretch";
  const notes = panel("Où j'en suis", "grow", { icon: ICONS.note, accent: "gold", link: false });
  right.append(notes.root);
  root.append(page);

  let etat: Etat | undefined;
  let reponse = "";
  let enCours = false;
  let sansSpoiler: boolean | undefined;
  let ecran = false;

  const demander = async (question: string, avecEcran: boolean) => {
    if (!question.trim() || enCours) return;
    enCours = true;
    reponse = "";
    drawCoach();
    try {
      const r = await api.invoke<{ texte: string }>("compagnon:demander", { question, sansSpoiler: sansSpoiler ?? etat?.profil?.histoire ?? true, ecran: avecEcran });
      reponse = r.texte;
    } catch (e) {
      reponse = `Je n'ai pas pu répondre : ${e instanceof Error ? e.message : String(e)}`;
    }
    enCours = false;
    drawCoach();
  };

  const drawJeu = () => {
    if (!etat) return;
    const j = etat.actuel;
    if (!j) {
      jeu.body.innerHTML = `<p class="lead">Aucun jeu détecté. <b>Lance un jeu</b> : je le reconnais tout seul (par son nom, ou parce qu'il vient de Steam, Epic, EA, Ubisoft, Xbox, Rockstar…) et la page s'adapte à son genre.</p>
        <p class="tip">Le jeu n'est pas reconnu ? Indique-le ici, ça marche pareil.</p>
        <div class="jeu-declarer"><input class="memory-search" data-nom placeholder="Nom du jeu" /><select data-genre>${etat.genres.map((g) => `<option value="${esc(g.genre)}">${esc(g.libelle)}</option>`).join("")}</select><button class="health-button small" data-declarer>C'est parti</button></div>`;
      const nom = jeu.body.querySelector<HTMLInputElement>("[data-nom]")!;
      jeu.body.querySelector<HTMLButtonElement>("[data-declarer]")!.onclick = async () => {
        if (!nom.value.trim()) return;
        await api.invoke("compagnon:declarer", { nom: nom.value, genre: jeu.body.querySelector<HTMLSelectElement>("[data-genre]")!.value });
        await load();
      };
      return;
    }
    jeu.body.innerHTML = `<div class="forme-tuile"><div class="v" style="font-size:1.3em">${esc(j.nom)}</div><div class="l">${esc(etat.profil?.libelle ?? "")}</div><small>${esc(duree(j.minutes ?? 0))} de jeu · ${esc(SOURCES[etat.manuel ? "manuel" : j.source] ?? j.source)}${j.lanceur ? ` (${esc(j.lanceur)})` : ""}</small></div>
      ${etat.autres.length ? `<p class="tip">Aussi ouvert : ${etat.autres.map((a) => esc(a.nom)).join(", ")}</p>` : ""}
      ${etat.manuel ? `<button class="health-button small" data-fin>J'ai fini de jouer</button>` : ""}`;
    jeu.body.querySelector<HTMLButtonElement>("[data-fin]")?.addEventListener("click", async () => {
      await api.invoke("compagnon:declarer", { nom: "" });
      await load();
    });
  };

  const drawHisto = () => {
    if (!etat) return;
    histo.body.innerHTML = etat.recents.length
      ? etat.recents.map((r) => `<div class="memory-meta"><span>${esc(r.jeu)}</span><small>${esc(duree(r.minutes))} · ${esc(jour(r.dernier))}</small></div>`).join("")
      : `<div class="empty">Rien encore : l'historique se remplit au fil de tes parties.</div>`;
  };

  const drawCoach = () => {
    if (!etat) return;
    const p = etat.profil;
    if (!etat.actuel || !p) {
      coach.body.innerHTML = `<div class="empty">Dès qu'un jeu est lancé, je te propose ici les aides qui lui correspondent : réglages, astuces, indices, mise au point, checklists…</div>`;
      return;
    }
    const spoil = sansSpoiler ?? p.histoire;
    coach.body.innerHTML = `<p class="lead">${esc(p.accroche)}</p>
      <div class="jeu-actions">${p.actions.map((a, i) => `<button class="health-button" data-action="${i}"${enCours ? " disabled" : ""}>${esc(a.libelle)}</button>`).join("")}</div>
      ${etat.genres.length && p.genre === "course" ? `<button class="health-button" data-course>Ouvrir l'Ingénieur de course</button>` : ""}
      <textarea class="memory-new" rows="2" data-question placeholder="Pose ta question sur ${esc(etat.actuel.nom)}…"></textarea>
      <div class="jeu-options"><label><input type="checkbox" data-spoil ${spoil ? "checked" : ""}/> Sans spoiler</label><label><input type="checkbox" data-ecran ${ecran ? "checked" : ""}/> Regarder mon écran</label><button class="health-button small" data-envoyer${enCours ? " disabled" : ""}>Demander</button></div>
      <div class="jeu-reponse">${enCours ? `<div class="empty">Je cherche…</div>` : reponse ? markdown(reponse) : ""}</div>`;
    coach.body.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((b) => {
      b.onclick = () => {
        const a = p.actions[Number(b.dataset.action)]!;
        void demander(a.question, a.ecran ?? ecran);
      };
    });
    const q = coach.body.querySelector<HTMLTextAreaElement>("[data-question]")!;
    coach.body.querySelector<HTMLButtonElement>("[data-envoyer]")!.onclick = () => void demander(q.value, ecran);
    coach.body.querySelector<HTMLInputElement>("[data-spoil]")!.onchange = (e) => (sansSpoiler = (e.target as HTMLInputElement).checked);
    coach.body.querySelector<HTMLInputElement>("[data-ecran]")!.onchange = (e) => (ecran = (e.target as HTMLInputElement).checked);
    coach.body.querySelector<HTMLButtonElement>("[data-course]")?.addEventListener("click", () => void api.invoke("compagnon:ouvrir-course"));
  };

  const drawNotes = () => {
    if (!etat) return;
    if (!etat.actuel) {
      notes.body.innerHTML = `<div class="empty">Quand un jeu tourne, note ici où tu en es : je te le rappellerai à la prochaine partie.</div>`;
      return;
    }
    notes.body.innerHTML = `<textarea class="memory-new" rows="2" data-nouvelle placeholder="ex. Bloqué au chapitre 3, il me faut la clé du sous-sol."></textarea><button class="health-button small" data-ajouter>Retenir</button>
      ${etat.notes.length ? etat.notes.map((n) => `<div class="memory-note" data-id="${esc(n.id)}"><p>${esc(n.texte)}</p><div class="memory-meta"><small>${esc(jour(n.date))}</small><button class="health-button small" data-del>Supprimer</button></div></div>`).join("") : `<div class="empty">Aucune note pour ce jeu.</div>`}`;
    const champ = notes.body.querySelector<HTMLTextAreaElement>("[data-nouvelle]")!;
    notes.body.querySelector<HTMLButtonElement>("[data-ajouter]")!.onclick = async () => {
      if (!champ.value.trim()) return;
      await api.invoke("compagnon:note", { texte: champ.value });
      await load();
    };
    notes.body.querySelectorAll<HTMLElement>(".memory-note").forEach((n) => {
      n.querySelector<HTMLButtonElement>("[data-del]")!.onclick = async () => {
        await api.invoke("compagnon:note-supprimer", n.dataset.id);
        await load();
      };
    });
  };

  const draw = () => {
    drawJeu();
    drawHisto();
    drawCoach();
    drawNotes();
  };
  /** « complet » : on redessine tout ; sinon seulement le jeu et l'historique, pour ne pas effacer ce que tu tapes. */
  const load = async (complet = true) => {
    const precedent = etat?.actuel?.nom;
    etat = await api.invoke<Etat>("compagnon:etat");
    const change = precedent !== etat.actuel?.nom;
    if (change) {
      reponse = "";
      sansSpoiler = undefined;
    }
    if (complet || change) draw();
    else {
      drawJeu();
      drawHisto();
    }
  };
  refresh.onclick = () => void load();
  api.on("compagnon:etat", () => void load(false));
  setInterval(() => document.visibilityState === "visible" && !enCours && void load(false), 30_000);
  void load();
}
