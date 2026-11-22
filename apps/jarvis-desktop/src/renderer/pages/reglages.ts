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
  // Toujours visible ; passe en orange quand un réglage enregistré demande un redémarrage.
  const restart = el("button", "chip", "<i></i>Redémarrer Jarvis");
  restart.title = "Ferme et relance Jarvis (les réglages marqués ↻ sont pris en compte au redémarrage)";
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
    restart.classList.add("warn");
    restart.innerHTML = "<i></i>Redémarrer Jarvis pour appliquer";
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
      // Le champ montre tout de suite que le mot de passe est enregistré (sinon on croit qu'il a disparu).
      for (const [key, input] of inputs) if (g.champs.find((x) => x.cle === key)?.type === "secret" && view.secrets[key] && input instanceof HTMLInputElement) input.placeholder = "•••••• enregistré dans le coffre-fort (tape pour remplacer)";
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
    content.replaceChildren(...view.groupes.map(renderGroup), renderBriefings(), renderConnectors());
    menu.insertAdjacentHTML("beforeend", `<a href="#groupe-briefings" data-g="briefings">${ICONS.alarm}<span>Briefings programmés</span></a><a href="#groupe-connecteurs" data-g="connecteurs">${ICONS.list}<span>Connecteurs (MCP)</span></a>`);
    if (needsRestart) markRestart();
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

// ---------- Connecteurs MCP ----------

interface Connector { nom: string; type: "commande" | "web"; commande?: string; arguments?: string[]; url?: string; actif: boolean; secrets: string[] }
interface Preset { nom: string; libelle: string; type: "commande" | "web"; commande?: string; url?: string; secrets?: string; aide: string }

/** Connecteurs MCP : des outils en plus pour Claude (Home Assistant, GitHub, un dossier…), branchés sans nouvelle version de Jarvis. */
function renderConnectors(): HTMLElement {
  const card = el("section", "panel setting-group");
  card.id = "groupe-connecteurs";
  card.innerHTML = `<h4><span class="ic">${ICONS.list}</span>Connecteurs (MCP)</h4>`;
  const body = el("div", "body");
  body.innerHTML = `<p class="lead">Des outils en plus pour Claude, au format standard MCP : Home Assistant, GitHub, Notion, un dossier du PC… Chaque connecteur est un programme lancé sur le PC ou une adresse web. Les jetons vont au coffre-fort. Une voix inconnue ne peut pas s'en servir, et chaque utilisation est notée dans le Journal.</p>`;
  const list = el("div", "connectors");
  const status = el("div", "status");
  const form = el("div", "connector-form");
  form.innerHTML = `
    <div class="presets"></div>
    <label class="field"><span class="name">Nom</span><div class="line"><input data-f="nom" placeholder="ex. home-assistant"></div></label>
    <label class="field"><span class="name">Type</span><div class="line"><select data-f="type"><option value="web">Adresse web (serveur MCP en ligne ou sur le réseau)</option><option value="commande">Programme lancé sur le PC</option></select></div></label>
    <label class="field" data-show="web"><span class="name">Adresse</span><div class="line"><input data-f="url" placeholder="https://…"></div></label>
    <label class="field hidden" data-show="commande"><span class="name">Commande</span><div class="line"><input data-f="commande" placeholder="npx -y @modelcontextprotocol/server-filesystem C:\\Dossier"></div></label>
    <label class="field"><span class="name">Secrets (une ligne « NOM=valeur » ; vide = garder les anciens)</span><div class="line"><textarea data-f="secrets" rows="2" placeholder="Authorization=Bearer …"></textarea></div><small data-aide></small></label>
    <div class="buttons"><button class="primary" data-save>Ajouter / mettre à jour</button></div>`;
  body.append(list, form, status);
  card.append(body);

  const field = (name: string) => form.querySelector<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>(`[data-f="${name}"]`)!;
  const showType = () => form.querySelectorAll<HTMLElement>("[data-show]").forEach((n) => n.classList.toggle("hidden", n.dataset.show !== field("type").value));
  field("type").onchange = showType;
  const say = (text: string, ok = true) => {
    status.className = `status ${ok ? "ok" : "bad"}`;
    status.textContent = text;
  };

  const draw = (connectors: Connector[]) => {
    list.innerHTML = connectors.length
      ? connectors
          .map(
            (c) => `<div class="connector ${c.actif ? "" : "off"}"><div class="grow"><b>${esc(c.nom)}</b> <small>${c.type === "web" ? esc(c.url ?? "") : esc([c.commande, ...(c.arguments ?? [])].join(" "))}</small>${c.secrets.length ? `<br><small>Secrets : ${c.secrets.map(esc).join(", ")} (dans le coffre-fort)</small>` : ""}</div>
            <button class="small" data-test="${esc(c.nom)}">Tester</button>
            <button class="small" data-toggle="${esc(c.nom)}" data-on="${!c.actif}">${c.actif ? "Désactiver" : "Activer"}</button>
            <button class="small ghost" data-del="${esc(c.nom)}">Supprimer</button></div>`,
          )
          .join("")
      : '<p class="empty">Aucun connecteur pour l\'instant.</p>';
    list.querySelectorAll<HTMLButtonElement>("[data-test]").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        say("Connexion en cours…");
        const r = await api.invoke<{ ok: boolean; message: string; outils: string[] }>("connecteurs:tester", b.dataset.test);
        say(`${r.message}${r.outils.length ? ` (${r.outils.slice(0, 12).join(", ")}${r.outils.length > 12 ? "…" : ""})` : ""}`, r.ok);
        b.disabled = false;
      };
    });
    list.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach((b) => (b.onclick = async () => draw((await api.invoke<{ connecteurs: Connector[] }>("connecteurs:basculer", { nom: b.dataset.toggle, actif: b.dataset.on === "true" })).connecteurs)));
    list.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) => {
      b.onclick = async () => {
        if (!window.confirm(`Supprimer le connecteur ${b.dataset.del} (et ses secrets) ?`)) return;
        draw((await api.invoke<{ connecteurs: Connector[] }>("connecteurs:supprimer", b.dataset.del)).connecteurs);
      };
    });
  };

  form.querySelector<HTMLButtonElement>("[data-save]")!.onclick = async () => {
    const r = await api.invoke<{ ok: boolean; message?: string; connecteurs: Connector[] }>("connecteurs:enregistrer", { nom: field("nom").value, type: field("type").value, url: field("url").value, commande: field("commande").value, secrets: field("secrets").value });
    if (r.ok) {
      field("secrets").value = "";
      say("Enregistré. Il servira dès la prochaine conversation avec Claude. Clique sur « Tester » pour vérifier.");
    } else say(r.message ?? "Erreur.", false);
    draw(r.connecteurs);
  };

  void api.invoke<{ connecteurs: Connector[]; modeles: Preset[] }>("connecteurs:lister").then((r) => {
    draw(r.connecteurs);
    const presets = form.querySelector<HTMLElement>(".presets")!;
    presets.innerHTML = `<small>Exemples : </small>${r.modeles.map((m, i) => `<button class="small ghost" data-preset="${i}">${esc(m.libelle)}</button>`).join(" ")}`;
    presets.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((b) => {
      b.onclick = () => {
        const m = r.modeles[Number(b.dataset.preset)]!;
        field("nom").value = m.nom;
        field("type").value = m.type;
        field("url").value = m.url ?? "";
        field("commande").value = m.commande ?? "";
        field("secrets").value = m.secrets ?? "";
        form.querySelector<HTMLElement>("[data-aide]")!.textContent = m.aide;
        showType();
      };
    });
  });
  return card;
}

// ---------- Briefings programmés ----------

interface Brief { id: string; sujet: string; heure: string; jours: string[]; canaux: string[]; actif: boolean }
const JOURS: Array<[string, string]> = [["lun", "L"], ["mar", "M"], ["mer", "M"], ["jeu", "J"], ["ven", "V"], ["sam", "S"], ["dim", "D"]];

/** Briefings programmés : une recherche web à heure fixe, envoyée à la voix et/ou sur Telegram. */
function renderBriefings(): HTMLElement {
  const card = el("section", "panel setting-group");
  card.id = "groupe-briefings";
  card.innerHTML = `<h4><span class="ic">${ICONS.alarm}</span>Briefings programmés</h4>`;
  const body = el("div", "body");
  body.innerHTML = `<p class="lead">Une recherche sur Internet à heure fixe, que Jarvis te résume à voix haute et/ou t'envoie sur Telegram. Par exemple : « l'actualité des simulateurs de course », chaque lundi à 8 h. Tu peux aussi le demander à la voix : « Hey Jarvis, chaque matin à 7 h résume-moi l'actu du sim racing sur Telegram ».</p>`;
  const list = el("div", "connectors");
  const status = el("div", "status");
  const form = el("div", "connector-form");
  form.innerHTML = `
    <label class="field"><span class="name">Sujet</span><div class="line"><input data-f="sujet" placeholder="ex. l'actualité des simulateurs de course"></div></label>
    <label class="field"><span class="name">Heure</span><div class="line"><input data-f="heure" type="time" value="08:00"></div></label>
    <label class="field"><span class="name">Jours (aucun coché = tous les jours)</span><div class="line jours">${JOURS.map(([v, l]) => `<label class="jour"><input type="checkbox" data-jour="${v}"> ${l}</label>`).join("")}</div></label>
    <label class="field"><span class="name">Envoi</span><div class="line"><label class="jour"><input type="checkbox" data-canal="voix" checked> À la voix</label> <label class="jour"><input type="checkbox" data-canal="telegram"> Sur Telegram</label></div></label>
    <div class="buttons"><button class="primary" data-add>Programmer</button></div>`;
  body.append(list, form, status);
  card.append(body);
  const say = (text: string, ok = true) => ((status.className = `status ${ok ? "ok" : "bad"}`), (status.textContent = text));

  const draw = (briefs: Brief[]) => {
    list.innerHTML = briefs.length
      ? briefs
          .map((b) => {
            const quand = b.jours.length === 0 || b.jours.length === 7 ? "chaque jour" : b.jours.join(", ");
            return `<div class="connector ${b.actif ? "" : "off"}"><div class="grow"><b>${esc(b.sujet)}</b> <small>${esc(quand)} à ${esc(b.heure)} · ${esc(b.canaux.join(" et "))}</small></div>
              <button class="small" data-test="${esc(b.id)}">Envoyer maintenant</button>
              <button class="small" data-toggle="${esc(b.id)}" data-on="${!b.actif}">${b.actif ? "Mettre en pause" : "Reprendre"}</button>
              <button class="small ghost" data-del="${esc(b.id)}">Supprimer</button></div>`;
          })
          .join("")
      : '<p class="empty">Aucun briefing programmé.</p>';
    list.querySelectorAll<HTMLButtonElement>("[data-test]").forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true;
        say("Recherche en cours… (une à deux minutes)");
        await api.invoke("briefings:tester", btn.dataset.test);
        say("Briefing envoyé. Regarde (ou écoute) le résultat.");
        btn.disabled = false;
      };
    });
    list.querySelectorAll<HTMLButtonElement>("[data-toggle]").forEach((btn) => (btn.onclick = async () => draw((await api.invoke<{ briefings: Brief[] }>("briefings:basculer", { id: btn.dataset.toggle, actif: btn.dataset.on === "true" })).briefings)));
    list.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((btn) => (btn.onclick = async () => draw((await api.invoke<{ briefings: Brief[] }>("briefings:supprimer", btn.dataset.del)).briefings)));
  };

  form.querySelector<HTMLButtonElement>("[data-add]")!.onclick = async () => {
    const sujet = form.querySelector<HTMLInputElement>('[data-f="sujet"]')!.value;
    const heure = form.querySelector<HTMLInputElement>('[data-f="heure"]')!.value;
    const jours = [...form.querySelectorAll<HTMLInputElement>("[data-jour]:checked")].map((c) => c.dataset.jour!);
    const canaux = [...form.querySelectorAll<HTMLInputElement>("[data-canal]:checked")].map((c) => c.dataset.canal!);
    const r = await api.invoke<{ ok: boolean; message?: string; briefings: Brief[] }>("briefings:ajouter", { sujet, heure, jours, canaux });
    if (r.ok) {
      form.querySelector<HTMLInputElement>('[data-f="sujet"]')!.value = "";
      say("Programmé.");
    } else say(r.message ?? "Erreur.", false);
    draw(r.briefings);
  };

  void api.invoke<{ briefings: Brief[] }>("briefings:lister").then((r) => draw(r.briefings));
  return card;
}
