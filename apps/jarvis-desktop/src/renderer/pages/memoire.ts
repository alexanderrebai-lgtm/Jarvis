import { api, el, esc, panel } from "../common.js";
import { buildPage, ICONS } from "../hud.js";

interface Fact { id: string; fait: string; creeLe: string }
interface Note { id: string; texte: string; tags: string[]; creeLe: string; rappelLe?: string; rappelEnvoye?: boolean }
interface Rappel { cle: string; source: string; texte: string; instant: string; avis?: "utile" | "inutile" }

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
  const proactif = panel("Ce que Jarvis a ressorti", "", { icon: ICONS.pulse, link: false });
  const rang = panel("Rangement de la mémoire", "", { icon: ICONS.list, accent: "gold", link: false });
  left.append(about.root, add.root, proactif.root, rang.root);

  const facts = panel("Ce que je sais de toi", "grow", { icon: ICONS.list, link: false });
  center.append(facts.root);
  center.style.alignItems = "stretch";
  const notes = panel("Notes et rappels", "grow", { icon: ICONS.note, accent: "gold" });
  right.append(notes.root);
  root.append(page);

  let data: { faits: Fact[]; notes: Note[]; rappels: Rappel[] } = { faits: [], notes: [], rappels: [] };
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
    const whenShort = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    proactif.body.innerHTML = data.rappels.length
      ? data.rappels.map((r) => `<div class="memory-note" data-cle="${esc(r.cle)}"><p>${esc(r.texte)}</p><div class="memory-meta"><small>${esc(whenShort(r.instant))}</small><button class="health-button small" data-avis="utile" ${r.avis === "utile" ? 'style="outline:2px solid var(--ok,#4ade80)"' : ""} title="Utile : j'en veux d'autres comme ça">👍</button><button class="health-button small" data-avis="inutile" ${r.avis === "inutile" ? 'style="outline:2px solid var(--bad,#ff6b6b)"' : ""} title="Pas utile : ne me le redis plus, et fais plus attention">👎</button></div></div>`).join("")
      : `<div class="empty">Rien pour l'instant. De lui-même, aux bonnes heures, Jarvis ressort une note oubliée ou un rappel utile avant un rendez-vous.</div>`;
    proactif.body.querySelectorAll<HTMLButtonElement>("[data-avis]").forEach((b) => {
      b.onclick = async () => {
        const cle = b.closest<HTMLElement>("[data-cle]")?.dataset.cle;
        if (!cle) return;
        await api.invoke("rappel:retour", { cle, avis: b.dataset.avis });
        await load();
      };
    });
  };

  interface Rang { id: string; type: "fusion" | "oubli"; texte?: string; pourquoi: string; etat: string; concernes: string[] }
  interface RangData { propositions: Rang[]; derniereRevue: string | null; message?: string }
  const drawRang = (d: RangData) => {
    const ouvertes = d.propositions.filter((p) => p.etat === "proposee");
    const faites = d.propositions.filter((p) => p.etat === "acceptee");
    rang.body.innerHTML = `<p class="lead">Chaque semaine, Jarvis cherche les doublons et le périmé. Tu valides ; tu peux annuler.</p>${d.message ? `<p class="tip">${esc(d.message)}</p>` : ""}
      ${ouvertes.map((p) => `<div class="memory-note" data-rg="${esc(p.id)}"><p><b>${p.type === "fusion" ? "Fusionner" : "Oublier"}</b> : ${p.concernes.map((c) => `« ${esc(c)} »`).join(" + ")}${p.type === "fusion" ? `<br>→ « ${esc(p.texte ?? "")} »` : ""}<br><small>${esc(p.pourquoi)}</small></p><div class="memory-meta"><button class="health-button small" data-ok>Accepter</button><button class="health-button small" data-no>Refuser</button></div></div>`).join("") || '<div class="empty">Rien à ranger pour l\'instant.</div>'}
      ${faites.map((p) => `<div class="memory-note" data-rg="${esc(p.id)}"><p>✅ ${p.type === "fusion" ? "Fusionné" : "Oublié"} : ${p.concernes.map((c) => `« ${esc(c)} »`).join(" + ")}</p><div class="memory-meta"><button class="health-button small" data-undo>Annuler</button></div></div>`).join("")}
      <div class="memory-meta"><small>${d.derniereRevue ? `Dernière revue : ${esc(new Date(d.derniereRevue).toLocaleDateString("fr-FR"))}` : "Pas encore de revue."}</small><button class="health-button small" data-run>Ranger maintenant</button></div>`;
    rang.body.querySelectorAll<HTMLElement>("[data-rg]").forEach((n) => {
      const agir = async (canal: string, payload: unknown) => {
        drawRang(await api.invoke<RangData>(canal, payload));
        await load();
      };
      n.querySelector<HTMLButtonElement>("[data-ok]")?.addEventListener("click", () => void agir("rangement:decider", { id: n.dataset.rg, accepte: true }));
      n.querySelector<HTMLButtonElement>("[data-no]")?.addEventListener("click", () => void agir("rangement:decider", { id: n.dataset.rg, accepte: false }));
      n.querySelector<HTMLButtonElement>("[data-undo]")?.addEventListener("click", () => void agir("rangement:annuler", { id: n.dataset.rg }));
    });
    rang.body.querySelector<HTMLButtonElement>("[data-run]")!.onclick = async (ev) => {
      (ev.target as HTMLButtonElement).disabled = true;
      drawRang(await api.invoke<RangData>("rangement:lancer"));
    };
  };

  const load = async () => {
    void api.invoke<RangData>("rangement:lire").then(drawRang).catch(() => undefined);
    data = await api.invoke<{ faits: Fact[]; notes: Note[]; rappels: Rappel[] }>("memoire:lire");
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
