import { api, el, esc, panel } from "../common.js";
import { buildPage, ICONS } from "../hud.js";

interface Fact { id: string; fait: string; creeLe: string }
interface Note { id: string; texte: string; tags: string[]; creeLe: string; rappelLe?: string; rappelEnvoye?: boolean }

const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

/** Mémoire : ce que Jarvis sait d'Alex (à voir, corriger, effacer) et ses notes. */
export function renderMemory(root: HTMLElement): void {
  const { page, left, center, right, tools } = buildPage({ id: "memoire", title: "Mémoire", cols: "minmax(260px, 22%) 1fr minmax(280px, 26%)" });
  const search = el("input", "memory-search") as HTMLInputElement;
  search.placeholder = "Chercher…";
  tools.prepend(search);

  const about = panel("Comment ça marche", "", { icon: ICONS.book });
  about.body.innerHTML = `<p class="lead">Quand tu dis quelque chose d'utile pour plus tard (« je suis allergique aux arachides », « ma sœur s'appelle Léa »), Jarvis le retient ici. Ces souvenirs sont relus au début de chaque conversation.</p><p class="lead">Tu peux tout corriger ou effacer. Rien ne quitte le PC, sauf ce que Claude lit pendant une conversation.</p>`;
  const add = panel("Ajouter un souvenir", "", { icon: ICONS.note, accent: "green" });
  add.body.innerHTML = `<textarea class="memory-new" rows="3" placeholder="ex. Je préfère qu'on me réveille en douceur, avec de la musique calme."></textarea><button class="health-button" data-add>Retenir</button>`;
  left.append(about.root, add.root);

  const facts = panel("Ce que je sais de toi", "grow", { icon: ICONS.list, link: false });
  center.append(facts.root);
  center.style.alignItems = "stretch";
  const notes = panel("Notes et rappels", "grow", { icon: ICONS.note, accent: "gold" });
  right.append(notes.root);
  root.append(page);

  let data: { faits: Fact[]; notes: Note[] } = { faits: [], notes: [] };
  const matches = (text: string) => !search.value.trim() || text.toLowerCase().includes(search.value.trim().toLowerCase());

  const draw = () => {
    const shown = data.faits.filter((f) => matches(f.fait));
    facts.title.querySelector("span:last-child")!.textContent = `Ce que je sais de toi (${data.faits.length})`;
    facts.body.innerHTML = shown.length
      ? shown.map((f) => `<div class="memory-fact" data-id="${esc(f.id)}"><p contenteditable="true" spellcheck="true">${esc(f.fait)}</p><div class="memory-meta"><small>${esc(day(f.creeLe))}</small><button class="health-button small" data-save hidden>Enregistrer</button><button class="health-button small" data-forget>Oublier</button></div></div>`).join("")
      : `<div class="empty">${data.faits.length ? "Rien pour cette recherche." : "Je ne sais encore rien de toi. Dis-moi « retiens que… » ou ajoute un souvenir à gauche."}</div>`;
    facts.body.querySelectorAll<HTMLElement>(".memory-fact").forEach((node) => {
      const text = node.querySelector<HTMLElement>("p")!;
      const save = node.querySelector<HTMLButtonElement>("[data-save]")!;
      const original = text.textContent ?? "";
      text.oninput = () => (save.hidden = (text.textContent ?? "").trim() === original.trim());
      save.onclick = async () => {
        await api.invoke("memoire:modifier", { id: node.dataset.id, fait: text.textContent ?? "" });
        await load();
      };
      node.querySelector<HTMLButtonElement>("[data-forget]")!.onclick = async () => {
        if (!window.confirm("Oublier ce souvenir ?")) return;
        await api.invoke("memoire:oublier", node.dataset.id);
        await load();
      };
    });
    const shownNotes = data.notes.filter((n) => matches(`${n.texte} ${n.tags.join(" ")}`));
    notes.body.innerHTML = shownNotes.length
      ? shownNotes.map((n) => `<div class="memory-note" data-id="${esc(n.id)}"><p>${esc(n.texte)}</p><div class="memory-meta"><small>${esc(day(n.creeLe))}${n.rappelLe ? ` · rappel ${esc(new Date(n.rappelLe).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}${n.rappelEnvoye ? " (fait)" : ""}` : ""}${n.tags.length ? ` · ${n.tags.map(esc).join(", ")}` : ""}</small><button class="health-button small" data-del>Supprimer</button></div></div>`).join("")
      : '<div class="empty">Aucune note.</div>';
    notes.body.querySelectorAll<HTMLElement>(".memory-note").forEach((node) => {
      node.querySelector<HTMLButtonElement>("[data-del]")!.onclick = async () => {
        if (!window.confirm("Supprimer cette note ?")) return;
        await api.invoke("memoire:note-supprimer", node.dataset.id);
        await load();
      };
    });
  };

  const load = async () => {
    data = await api.invoke<{ faits: Fact[]; notes: Note[] }>("memoire:lire");
    draw();
  };
  search.oninput = draw;
  add.body.querySelector<HTMLButtonElement>("[data-add]")!.onclick = async () => {
    const box = add.body.querySelector<HTMLTextAreaElement>("textarea")!;
    if (!box.value.trim()) return;
    await api.invoke("memoire:ajouter", box.value);
    box.value = "";
    await load();
  };
  void load();
}
