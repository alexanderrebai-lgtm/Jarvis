import { renderMarkdown } from "../../shared/markdown.js";
import { api, el, esc, fillPanel, panel, showModelFrom, type PanelPayload } from "../common.js";
import { buildPage, createReactor, ICONS, linkToReactor } from "../hud.js";

interface FileEntry { chemin: string; taille: number; modifie: number }
interface Snapshot {
  vue: "code" | "rd";
  dossier: string;
  nom: string;
  fichiers: FileEntry[];
  fichier?: { chemin: string; contenu: string; langage: string };
  apercu?: { type: "url"; url: string; version: number } | { type: "fichier"; chemin: string; genre: "page" | "image" | "modele3d" | "pdf" | "video"; version: number };
  journal?: string;
  medias: FileEntry[];
}

const KEYWORDS = /\b(?:const|let|var|function|return|if|else|elif|for|while|import|from|export|default|class|def|async|await|new|try|catch|except|finally|throw|raise|in|of|true|false|null|undefined|None|True|False|self|this|type|interface|public|private|static|void|int|float|double|bool|struct|module|union|difference|translate|rotate|cube|cylinder|sphere|with|as|lambda|yield|switch|case|break|continue)\b/;
const TOKEN = /(\/\/.*$|#(?!include).*$|\/\*.*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/g;

/** Coloration légère, sans bibliothèque : commentaires, chaînes, mots-clés, nombres. */
export function highlight(code: string, langage: string): string {
  const hashComments = ["python", "powershell", "bash", "yml", "yaml", "toml"].includes(langage);
  return code
    .split("\n")
    .map((line) => {
      let html = "";
      let last = 0;
      for (const match of line.matchAll(TOKEN)) {
        const token = match[0];
        html += esc(line.slice(last, match.index));
        last = (match.index ?? 0) + token.length;
        if ((token.startsWith("//") || token.startsWith("/*") || (token.startsWith("#") && hashComments))) html += `<span class="c">${esc(token)}</span>`;
        else if (/^["'`]/.test(token)) html += `<span class="s">${esc(token)}</span>`;
        else if (/^\d/.test(token)) html += `<span class="n">${esc(token)}</span>`;
        else if (KEYWORDS.test(token) && token.match(KEYWORDS)![0] === token) html += `<span class="k">${esc(token)}</span>`;
        else html += esc(token);
      }
      html += esc(line.slice(last));
      return `<span class="ln">${html || " "}</span>`;
    })
    .join("");
}

function previewUrl(vue: string, chemin: string, version: number): string {
  return `apercu://${vue}/${chemin.split("/").map(encodeURIComponent).join("/")}?v=${version}`;
}

/** Pages Code (code + aperçu en direct) et R&D (journal, modèles, images). */
export function renderProject(root: HTMLElement, vue: "code" | "rd"): void {
  const isCode = vue === "code";
  const { page, left, center, right, tools } = buildPage({
    id: vue,
    title: isCode ? "Code" : "Recherche et développement",
    cols: isCode ? "minmax(0, 1.2fr) minmax(260px, 300px) minmax(0, 1fr)" : "minmax(280px, 22%) 1fr minmax(260px, 20%)",
  });
  const name = el("span", "chip off", "<i></i>Aucun projet");
  tools.prepend(name);

  // Code : le code à gauche, Jarvis et les fichiers au centre, l'aperçu à droite.
  // R&D : le journal à gauche, Jarvis et l'atelier (3D, calculs) au centre, les médias à droite.
  const reactor = createReactor(isCode ? 220 : Math.round(Math.min(innerHeight * 0.24, 220)), "J.A.R.V.I.S.");
  const main = panel(isCode ? "Code" : "Atelier", "grow", { icon: isCode ? ICONS.code : ICONS.cube, accent: "violet", link: isCode });
  const tree = panel(isCode ? "Fichiers" : "Journal du projet", "grow", { icon: isCode ? ICONS.folder : ICONS.book, link: !isCode });
  if (isCode) tree.body.classList.add("tree");
  const side = panel(isCode ? "Aperçu en direct" : "Médias", "grow", { icon: isCode ? ICONS.eye : ICONS.image, accent: isCode ? "green" : "gold" });
  if (isCode) {
    left.append(main.root);
    center.append(reactor, tree.root);
  } else {
    left.append(tree.root);
    center.append(reactor, main.root);
    side.body.classList.add("gallery");
  }
  center.style.alignItems = "stretch";
  reactor.style.alignSelf = "center";
  right.append(side.root);
  root.append(page);
  linkToReactor(page, reactor.querySelector<HTMLElement>(".reactor")!);

  let current: Snapshot | undefined;
  let selectedMedia: string | undefined;
  let lastPreviewKey = "";

  const renderMain = (s: Snapshot) => {
    if (isCode) {
      main.title.innerHTML = `<span>${esc(s.fichier?.chemin ?? "Code")}</span><small>${esc(s.fichier?.langage ?? "")}</small>`;
      main.body.innerHTML = s.fichier ? `<div class="code">${highlight(s.fichier.contenu, s.fichier.langage)}</div>` : '<div class="empty">Choisis un fichier à gauche, ou demande à Jarvis de te montrer son code.</div>';
      return;
    }
    const media = s.medias.find((m) => m.chemin === selectedMedia) ?? s.medias[0];
    main.title.innerHTML = `<span>${esc(media?.chemin ?? "Atelier")}</span>`;
    main.body.replaceChildren();
    if (!media) return void (main.body.innerHTML = '<div class="empty">Les modèles 3D et images du projet s\'afficheront ici.</div>');
    if (/\.stl$/i.test(media.chemin)) {
      const holder = el("div");
      holder.style.cssText = "height:100%;min-height:360px;display:flex";
      main.body.append(holder);
      void showModelFrom(holder, previewUrl("rd", media.chemin, media.modifie));
    } else if (/\.(png|jpe?g|gif|webp|svg)$/i.test(media.chemin)) {
      main.body.innerHTML = `<img src="${previewUrl("rd", media.chemin, media.modifie)}" style="width:100%;height:100%;object-fit:contain">`;
    } else if (/\.pdf$/i.test(media.chemin)) {
      main.body.innerHTML = `<div class="preview" style="height:100%"><embed src="${previewUrl("rd", media.chemin, media.modifie)}" type="application/pdf"></div>`;
    }
  };

  const renderPreview = (s: Snapshot) => {
    const p = s.apercu;
    const key = p ? `${p.type}|${"url" in p ? p.url : p.chemin}|${p.version}` : "";
    if (key === lastPreviewKey) return;
    lastPreviewKey = key;
    side.body.replaceChildren();
    if (!p) return void (side.body.innerHTML = '<div class="empty">Jarvis affiche ici le résultat en direct : la page, l\'appli, l\'image ou la pièce 3D, à chaque modification.</div>');
    const box = el("div", "preview");
    box.style.height = "100%";
    side.body.style.display = "flex";
    side.body.append(box);
    if (p.type === "url") box.innerHTML = `<iframe src="${esc(p.url)}" sandbox="allow-scripts allow-forms allow-same-origin"></iframe>`;
    else if (p.genre === "page") box.innerHTML = `<iframe src="${previewUrl("code", p.chemin, p.version)}" sandbox="allow-scripts allow-forms"></iframe>`;
    else if (p.genre === "image") box.innerHTML = `<img src="${previewUrl("code", p.chemin, p.version)}">`;
    else if (p.genre === "video") box.innerHTML = `<video src="${previewUrl("code", p.chemin, p.version)}" controls autoplay muted loop></video>`;
    else if (p.genre === "pdf") box.innerHTML = `<embed src="${previewUrl("code", p.chemin, p.version)}" type="application/pdf">`;
    else if (p.genre === "modele3d") {
      box.classList.add("dark");
      void showModelFrom(box, previewUrl("code", p.chemin, p.version));
    }
  };

  const render = (s: Snapshot) => {
    if (!s.dossier) return;
    current = s;
    name.classList.remove("off");
    name.innerHTML = `<i></i>${esc(s.nom)}`;
    name.animate([{ boxShadow: "0 0 24px rgba(159,232,255,.7)" }, { boxShadow: "none" }], { duration: 900 });
    if (isCode) {
      const recent = Date.now() - 2 * 60_000;
      tree.body.innerHTML = s.fichiers.map((f) => `<div class="f ${f.chemin === s.fichier?.chemin ? "on" : ""} ${f.modifie > recent ? "recent" : ""}" data-path="${esc(f.chemin)}">${esc(f.chemin)}</div>`).join("");
      tree.body.querySelectorAll<HTMLElement>(".f").forEach((node) => (node.onclick = () => void api.invoke("projet:fichier", { vue, chemin: node.dataset.path })));
      renderPreview(s);
    } else {
      tree.body.innerHTML = s.journal ? `<div class="md">${renderMarkdown(s.journal)}</div>` : '<div class="empty">Pas encore de JOURNAL.md dans ce projet.</div>';
      side.body.innerHTML = s.medias.length
        ? s.medias.map((m) => `<div class="m ${m.chemin === (selectedMedia ?? s.medias[0]?.chemin) ? "on" : ""}" data-path="${esc(m.chemin)}">${/\.(png|jpe?g|gif|webp|svg)$/i.test(m.chemin) ? `<img src="${previewUrl("rd", m.chemin, m.modifie)}">` : esc(m.chemin.split("/").pop())}</div>`).join("")
        : '<div class="empty" style="grid-column:1/-1">Aucun média pour l\'instant.</div>';
      side.body.querySelectorAll<HTMLElement>(".m").forEach((node) => (node.onclick = () => ((selectedMedia = node.dataset.path), current && render(current))));
      // Image illisible : on affiche son nom plutôt qu'une icône cassée.
      side.body.querySelectorAll<HTMLImageElement>(".m img").forEach((img) => (img.onerror = () => img.replaceWith(document.createTextNode(img.closest<HTMLElement>(".m")?.dataset.path?.split("/").pop() ?? ""))));
    }
    renderMain(s);
  };

  // R&D : les résultats envoyés par Jarvis (calculs, graphiques) passent dans l'atelier.
  api.on("jarvis:panel", (payload: PanelPayload) => {
    main.title.innerHTML = `<span>${esc(payload.titre)}</span>`;
    fillPanel(main.body, payload);
  });
  api.on("projet:data", (s: Snapshot) => s.vue === vue && render(s));
  void api.invoke<{ projet: Snapshot }>("page:data", vue).then((d) => {
    if (d.projet?.dossier) render(d.projet);
    else {
      tree.body.innerHTML = `<div class="empty">${isCode ? "Demande « montre-moi le code du projet… »." : "Demande « montre-moi le projet… » ou « ouvre le labo sur le support volant »."}</div>`;
      main.body.innerHTML = '<div class="empty">Aucun projet affiché.</div>';
      renderPreview({ vue, dossier: "", nom: "", fichiers: [], medias: [] });
    }
  });
}
