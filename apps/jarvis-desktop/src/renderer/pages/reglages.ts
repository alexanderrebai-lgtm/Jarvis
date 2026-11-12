import { api, el, esc } from "../common.js";
import { buildPage, ICONS } from "../hud.js";

interface Field {
  cle: string;
  libelle: string;
  type: "texte" | "secret" | "fichier" | "dossier" | "nombre" | "heure" | "choix" | "liste";
  aide?: string;
  exemple?: string;
  options?: Array<{ valeur: string; libelle: string }>;
  redemarrage?: boolean;
  filtres?: Array<{ name: string; extensions: string[] }>;
}
interface Group { id: string; titre: string; description: string; champs: Field[]; actions?: Array<{ id: string; libelle: string }>; guide?: string }
interface View { groupes: Group[]; valeurs: Record<string, string>; secrets: Record<string, boolean>; coffre: boolean }
interface ActionResult { ok: boolean; message: string; images?: Array<{ nom: string; src: string }>; redemarrage?: boolean }

const GROUP_ICONS: Record<string, string> = { general: ICONS.sun, tapo: ICONS.home, google: ICONS.mail, spotify: ICONS.pulse, reveil: ICONS.alarm, cameras: ICONS.camera, alertes: ICONS.bell, voix: ICONS.motion, travail: ICONS.work, cerveau: ICONS.cpu, sauvegardes: ICONS.disk };

/** Réglages : chaque élément à relier, avec ses champs, ses boutons « Tester » et « Connecter ». */
export function renderSettings(root: HTMLElement): void {
  const { page, tools } = buildPage({ id: "reglages", title: "Réglages", cols: "1fr" });
  page.classList.add("settings-page");
  const restart = el("button", "chip warn hidden", "<i></i>Redémarrer Jarvis pour appliquer");
  restart.onclick = () => api.send("jarvis:redemarrer");
  tools.prepend(restart);

  const shell = el("div", "settings");
  const menu = el("nav", "settings-menu");
  const content = el("div", "settings-content");
  shell.append(menu, content);
  page.querySelector(".col.center")!.replaceChildren(shell);
  page.querySelectorAll(".col.left, .col.right").forEach((c) => c.remove());
  root.append(page);

  let view: View | undefined;
  let needsRestart = false;
  const markRestart = () => {
    needsRestart = true;
    restart.classList.remove("hidden");
  };

  const renderGroup = (g: Group): HTMLElement => {
    const card = el("section", "panel setting-group");
    card.id = `groupe-${g.id}`;
    card.innerHTML = `<h4><span class="ic">${GROUP_ICONS[g.id] ?? ICONS.list}</span>${esc(g.titre)}</h4>`;
    const body = el("div", "body");
    body.insertAdjacentHTML("beforeend", `<p class="lead">${esc(g.description)}</p>${g.guide ? `<details class="guide"><summary>Comment faire</summary><pre>${esc(g.guide)}</pre></details>` : ""}`);
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    for (const f of g.champs) {
      const row = el("label", "field");
      const isSecret = f.type === "secret";
      const saved = isSecret ? view!.secrets[f.cle] : false;
      row.innerHTML = `<span class="name">${esc(f.libelle)}${f.redemarrage ? ' <em title="Pris en compte après un redémarrage de Jarvis">↻</em>' : ""}</span>`;
      let input: HTMLInputElement | HTMLSelectElement;
      if (f.type === "choix") {
        const select = el("select");
        const current = view!.valeurs[f.cle] ?? "";
        select.innerHTML = `${current && !f.options?.some((o) => o.valeur === current) ? `<option value="${esc(current)}">${esc(current)}</option>` : ""}${(f.options ?? []).map((o) => `<option value="${esc(o.valeur)}" ${o.valeur === current ? "selected" : ""}>${esc(o.libelle)}</option>`).join("")}`;
        if (!current) select.selectedIndex = 0;
        input = select;
      } else {
        const i = el("input");
        i.type = isSecret ? "password" : f.type === "nombre" ? "text" : f.type === "heure" ? "time" : "text";
        i.autocomplete = "off";
        i.spellcheck = false;
        i.value = isSecret ? "" : (view!.valeurs[f.cle] ?? "");
        i.placeholder = isSecret ? (saved ? "•••••• enregistré dans le coffre-fort (tape pour remplacer)" : "à renseigner") : (f.exemple ? `ex. ${f.exemple}` : "");
        input = i;
      }
      input.dataset.key = f.cle;
      inputs.set(f.cle, input);
      const line = el("div", "line");
      line.append(input);
      if (f.type === "fichier" || f.type === "dossier") {
        const pick = el("button", "small", "Parcourir…");
        pick.type = "button";
        pick.onclick = async () => {
          const chosen = await api.invoke<string | undefined>("reglages:choisir", { type: f.type, ...(f.filtres ? { filtres: f.filtres } : {}) });
          if (chosen) (input as HTMLInputElement).value = chosen;
        };
        line.append(pick);
      }
      if (isSecret && saved) {
        const clear = el("button", "small ghost", "Effacer");
        clear.type = "button";
        clear.onclick = async () => {
          await api.invoke("reglages:enregistrer", { valeurs: {}, effacer: [f.cle] });
          if (f.redemarrage) markRestart();
          await load();
        };
        line.append(clear);
      }
      row.append(line);
      if (f.aide) row.insertAdjacentHTML("beforeend", `<small>${esc(f.aide)}</small>`);
      body.append(row);
    }
    const status = el("div", "status");
    const buttons = el("div", "buttons");
    const save = async (): Promise<boolean> => {
      const valeurs: Record<string, string> = {};
      for (const [key, input] of inputs) {
        const value = input.value.trim();
        const field = g.champs.find((x) => x.cle === key)!;
        if (field.type === "secret" && !value) continue;
        if (field.type !== "secret" && value === (view!.valeurs[key] ?? "")) continue;
        valeurs[key] = value;
      }
      if (!Object.keys(valeurs).length) return true;
      const r = await api.invoke<{ enregistres: string[]; redemarrage: string[] }>("reglages:enregistrer", { valeurs });
      if (r.redemarrage.length) markRestart();
      status.className = "status ok";
      status.textContent = r.redemarrage.length ? "Enregistré. Certains changements demandent de redémarrer Jarvis (bouton en haut)." : "Enregistré et appliqué.";
      for (const [key, input] of inputs) if (g.champs.find((x) => x.cle === key)?.type === "secret" && input.value) input.value = "";
      view = await api.invoke<View>("reglages:lire");
      return true;
    };
    const saveBtn = el("button", "primary", "Enregistrer");
    saveBtn.onclick = () => void save();
    buttons.append(saveBtn);
    for (const a of g.actions ?? []) {
      const b = el("button", "", esc(a.libelle));
      b.onclick = async () => {
        b.disabled = true;
        status.className = "status";
        status.textContent = "En cours…";
        await save();
        const r = await api.invoke<ActionResult>("reglages:action", a.id);
        status.className = `status ${r.ok ? "ok" : "bad"}`;
        status.innerHTML = `${esc(r.message)}${r.images?.length ? `<div class="thumbs">${r.images.map((i) => `<figure><img src="${i.src}"><figcaption>${esc(i.nom)}</figcaption></figure>`).join("")}</div>` : ""}`;
        if (r.redemarrage) markRestart();
        b.disabled = false;
      };
      buttons.append(b);
    }
    body.append(buttons, status);
    card.append(body);
    return card;
  };

  const load = async () => {
    view = await api.invoke<View>("reglages:lire");
    menu.innerHTML = view.groupes.map((g) => `<a href="#groupe-${g.id}" data-g="${g.id}">${GROUP_ICONS[g.id] ?? ""}<span>${esc(g.titre)}</span></a>`).join("") + (view.coffre ? "" : '<p class="warn">Chiffrement indisponible : les mots de passe restent dans jarvis.env.</p>');
    content.replaceChildren(...view.groupes.map(renderGroup));
    if (needsRestart) restart.classList.remove("hidden");
  };
  const focusGroup = (id: string) => {
    const target = document.getElementById(`groupe-${id}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    target?.classList.add("flash");
    setTimeout(() => target?.classList.remove("flash"), 1800);
  };
  api.on("reglages:groupe", (id: string) => void (view ? focusGroup(id) : load().then(() => focusGroup(id))));
  void load();
}
