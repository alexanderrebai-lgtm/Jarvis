import { api, el, esc, hhmm, panel } from "../common.js";
import { buildPage, createReactor, ICONS, linkToReactor } from "../hud.js";

interface SecurityData {
  cameras: Array<{ nom: string; url: string; enDirect: boolean }>;
  evenements: SecurityEvent[];
  surveillance: boolean;
  mode?: Mode;
  configure: boolean;
}
type Mode = "off" | "simple" | "complete";
interface SecurityEvent { camera: string; instant: string; intensitePct: number; image?: string; video?: string; personne?: boolean }

/** Chemin d'une image d'événement servie par le protocole interne (dossier securite seulement). */
function eventImage(image?: string): string | undefined {
  if (!image) return undefined;
  const part = image.split(/[\\/]securite[\\/]/).pop();
  return part ? `apercu://securite/${part.split(/[\\/]/).map(encodeURIComponent).join("/")}` : undefined;
}

export function renderSecurity(root: HTMLElement): void {
  const { page, left, center, right, tools } = buildPage({ id: "securite", title: "Sécurité", cols: "minmax(270px, 20%) 1fr minmax(290px, 22%)" });
  const modes = el("div", "modes");
  modes.style.cssText = "display:flex;gap:6px";
  const buttons = (["off", "simple", "complete"] as const).map((m) => {
    const b = el("button", "chip", `<i></i>${{ off: "Arrêtée", simple: "Simple", complete: "Complète" }[m]}`);
    b.onclick = async () => setMode(await api.invoke<Mode>("securite:mode", m));
    modes.append(b);
    return [m, b] as const;
  });
  tools.prepend(modes);

  const status = panel("Caméras", "", { icon: ICONS.camera, accent: "gold" });
  const help = panel("Surveillance", "grow", { icon: ICONS.shield, accent: "gold" });
  left.append(status.root, help.root);

  const reactor = createReactor(Math.round(Math.min(innerHeight * 0.2, 190)), "J.A.R.V.I.S.");
  const feeds = panel("En direct", "grow", { icon: ICONS.eye, accent: "gold", link: false });
  const grid = el("div", "cams");
  feeds.body.append(grid);
  center.append(reactor, feeds.root);
  center.style.alignItems = "stretch";
  reactor.style.alignSelf = "center";

  const events = panel("Mouvements", "grow", { icon: ICONS.motion, accent: "red" });
  right.append(events.root);
  root.append(page);
  linkToReactor(page, reactor.querySelector<HTMLElement>(".reactor")!);

  const setMode = (mode: Mode) => {
    for (const [m, b] of buttons) b.className = `chip ${m === mode ? (m === "complete" ? "danger" : m === "simple" ? "warn" : "") : "off"}`;
    help.body.innerHTML = {
      off: '<div class="row"><span>Les mouvements sont enregistrés sans alerte.</span></div><div class="empty">Dis « active la surveillance complète » ou « je pars » en quittant la maison.</div>',
      simple: '<div class="row"><span>Chaque mouvement est annoncé et notifié.</span></div><div class="empty">Dis « désactive la surveillance » pour l\'arrêter.</div>',
      complete: '<div class="row"><span>Surveillance complète : je vérifie qu\'il s\'agit d\'une personne, j\'enregistre 20 secondes de vidéo, je t\'envoie la photo sur ton téléphone, j\'allume les lumières et je préviens l\'intrus.</span></div><div class="empty">Jarvis est rouge tant qu\'elle est active. Seule ta voix peut l\'arrêter.</div>',
    }[mode];
  };
  api.on("jarvis:flags", (f: { surveillance?: Mode }) => f.surveillance && setMode(f.surveillance));

  const addEvent = (e: SecurityEvent, prepend = false) => {
    const src = eventImage(e.image);
    const what = e.personne === true ? "personne détectée" : e.personne === false ? "pas de personne" : `${e.intensitePct} % de l'image`;
    const row = el("div", "event", `${src ? `<img src="${src}">` : ""}<div><b>${esc(e.camera)}</b><br><span class="v">${hhmm(e.instant)} · ${esc(what)}${e.video ? " · vidéo" : ""}</span></div>`);
    if (prepend) events.body.prepend(row);
    else events.body.append(row);
    const cam = grid.querySelector<HTMLElement>(`[data-cam="${CSS.escape(e.camera)}"]`);
    if (prepend && cam) {
      cam.classList.add("flash");
      setTimeout(() => cam.classList.remove("flash"), 4000);
    }
  };

  void api.invoke<SecurityData>("page:data", "securite").then((d) => {
    setMode(d.mode ?? (d.surveillance ? "simple" : "off"));
    if (!d.configure) {
      grid.innerHTML = `<div class="md" style="font-size:14px;line-height:1.8;grid-column:1/-1"><b>Aucune caméra configurée.</b><br>
        1. Dans l'appli Tapo, ouvre chaque caméra → Paramètres → Paramètres avancés → <b>Compte de la caméra</b>, et crée un identifiant et un mot de passe.<br>
        2. Réserve une adresse IP fixe pour chaque caméra dans ta box.<br>
        3. Dans les réglages de Jarvis : <code>TAPO_CAMERAS=Entrée=192.168.1.30,Salon=192.168.1.31</code>, <code>TAPO_CAMERA_COMPTE</code> et <code>TAPO_CAMERA_MOT_DE_PASSE</code>, puis relance Jarvis.</div>`;
      status.body.innerHTML = '<div class="empty">—</div>';
      return;
    }
    grid.innerHTML = d.cameras.map((c) => `<div class="cam" data-cam="${esc(c.nom)}"><img src="${esc(c.url)}" alt=""><span class="tag">${esc(c.nom)}</span><span class="live"><i></i>DIRECT</span></div>`).join("");
    status.body.innerHTML = d.cameras.map((c) => `<div class="row"><span>${esc(c.nom)}</span><span class="v ${c.enDirect ? "good" : "warnc"}">${c.enDirect ? "en direct" : "connexion…"}</span></div>`).join("");
    events.body.replaceChildren();
    if (!d.evenements.length) events.body.innerHTML = '<div class="empty">Aucun mouvement détecté.</div>';
    d.evenements.forEach((e) => addEvent(e));
  });
  api.on("securite:evenement", (e: SecurityEvent) => {
    events.body.querySelector(".empty")?.remove();
    addEvent(e, true);
  });
}
