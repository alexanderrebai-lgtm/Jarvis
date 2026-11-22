import { api, el, esc, panel } from "../common.js";
import { buildPage, ICONS } from "../hud.js";

interface Mesure { type: string; libelle: string; valeur: number; unite: string; instant: string }
interface Connexion { active: boolean; url: string; urlDistante: string | null; jeton: string }

const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Ma forme : données de la montre connectée (pas, rythme, sommeil…) reçues sur le PC, sans cloud. */
export function renderForme(root: HTMLElement): void {
  const { page, left, center, right, tools } = buildPage({ id: "forme", title: "Ma forme", cols: "minmax(260px, 22%) 1fr minmax(300px, 28%)" });
  const refresh = el("button", "chip", "<i></i>Actualiser");
  tools.prepend(refresh);

  const resume = panel("Aujourd'hui", "grow", { icon: ICONS.pulse, link: false });
  center.append(resume.root);
  const about = panel("Brancher ma montre", "grow", { icon: ICONS.book, accent: "gold" });
  right.append(about.root);
  const info = panel("Comment ça marche", "", { icon: ICONS.health });
  info.body.innerHTML = `<p class="lead">Jarvis reçoit les données de ta montre directement sur le PC, sur le réseau de la maison, <b>sans aucun cloud</b>. Une petite appli du téléphone les lui envoie.</p><p class="lead">Rien ne sort du PC. Utile pour le réveil, un conseil, ou quand tu demandes « comment je vais ? ».</p>`;
  left.append(info.root);
  root.append(page);

  const render = (mesures: Mesure[], c: Connexion) => {
    resume.body.innerHTML = mesures.length
      ? `<div class="forme-grid">${mesures
          .map((m) => `<div class="forme-tuile"><div class="v">${esc(String(m.valeur))}<span>${esc(m.unite)}</span></div><div class="l">${esc(m.libelle)}</div><small>${esc(when(m.instant))}</small></div>`)
          .join("")}</div>`
      : `<div class="empty">Aucune donnée reçue pour l'instant.${c.active ? " Lance l'envoi depuis l'appli du téléphone (à droite), puis « Actualiser »." : " Active d'abord la réception dans Réglages → Santé, puis redémarre Jarvis."}</div>`;

    about.body.innerHTML = c.active
      ? `<p class="lead">Dans l'appli du téléphone, règle l'envoi (webhook / REST) vers :</p>
         <div class="forme-url"><code>${esc(c.url)}</code></div>
         ${c.urlDistante ? `<p class="lead"><b>Depuis n'importe où</b> (Tailscale détecté) :</p><div class="forme-url"><code>${esc(c.urlDistante)}</code></div>` : `<p class="tip">Pour que ça marche aussi hors de la maison (4G, travail), installe <b>Tailscale</b> sur le PC et le téléphone : Jarvis affichera ici une adresse joignable de partout, sans ouvrir de port sur ta box.</p>`}
         <p class="lead">En-tête : <code>x-jeton: ${esc(c.jeton)}</code> (ou ajoute <code>?jeton=${esc(c.jeton)}</code> à l'adresse).</p>
         <p class="lead"><b>iPhone / Apple Santé</b> : appli « Health Auto Export » → automatisation « REST API », méthode POST, cette adresse.</p>
         <p class="lead"><b>Android</b> : installe l'appli « Health Connect Webhook » (Play Store). Autorise-la à lire tes données dans Health Connect, ajoute un webhook avec l'adresse ci-dessus et un en-tête personnalisé <code>x-jeton</code> = le code. Il faut que ta montre envoie déjà ses données à Health Connect (selon la montre, ça passe par son appli).</p>
         <p class="tip">Le PC et le téléphone doivent être sur le même Wi-Fi. Si rien n'arrive, autorise Jarvis sur le réseau privé dans le pare-feu de Windows.</p>`
      : `<p class="lead">La réception est désactivée. Va dans <b>Réglages → Santé (montre connectée)</b>, mets « Oui », puis redémarre Jarvis. L'adresse et le code à mettre dans l'appli apparaîtront ici.</p>`;
  };

  const load = async () => {
    const r = await api.invoke<{ resume: Mesure[]; connexion: Connexion }>("forme:lire");
    render(r.resume, r.connexion);
  };
  refresh.onclick = () => void load();
  setInterval(() => document.visibilityState === "visible" && void load(), 30_000);
  void load();
}
