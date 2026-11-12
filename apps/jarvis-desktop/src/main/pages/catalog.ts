/**
 * Les pages de Jarvis. L'accueil est toujours là ; les autres s'ouvrent à la
 * demande, chacune sur l'écran qui lui est attribué.
 */

export type PageId = "accueil" | "ingenieur" | "travail" | "code" | "rd" | "securite" | "performances" | "diagnostic" | "reglages";

export interface PageInfo {
  id: PageId;
  titre: string;
  /** Mots qui désignent la page à l'oral. */
  mots: string[];
  /** Écran par défaut avec trois écrans. */
  ecranParDefaut: ScreenName;
  /** Ce que Jarvis dit en l'ouvrant. */
  annonce: string;
}

export type ScreenName = "gauche" | "centre" | "droite";

export const PAGES: PageInfo[] = [
  { id: "accueil", annonce: "Retour à l'accueil.", titre: "Accueil", mots: ["accueil", "maison principale", "ecran d'accueil", "tableau de bord"], ecranParDefaut: "centre" },
  { id: "ingenieur", annonce: "Voilà le muret des stands.", titre: "Ingénieur de course", mots: ["ingenieur", "course", "telemetrie", "simu", "simulateur", "stand", "radio"], ecranParDefaut: "gauche" },
  { id: "travail", annonce: "Voilà ton espace de travail.", titre: "Travail", mots: ["travail", "boulot", "equipe", "bureau", "teleconseil"], ecranParDefaut: "droite" },
  { id: "code", annonce: "Voilà l'atelier de code.", titre: "Code", mots: ["code", "programmation", "developpement", "dev", "logiciel", "rendu", "apercu"], ecranParDefaut: "droite" },
  { id: "rd", annonce: "Voilà le laboratoire.", titre: "Recherche et développement", mots: ["r&d", "r et d", "rd", "recherche", "laboratoire", "labo", "projet", "projets", "prototype"], ecranParDefaut: "gauche" },
  { id: "securite", annonce: "Voilà les caméras.", titre: "Sécurité", mots: ["securite", "surveillance", "camera", "cameras", "videosurveillance", "alarme"], ecranParDefaut: "droite" },
  { id: "performances", annonce: "Voilà l'état du PC.", titre: "Performances du PC", mots: ["performance", "performances", "pc", "ordinateur", "processeur", "carte graphique", "temperatures", "systeme", "ressources"], ecranParDefaut: "gauche" },
  { id: "diagnostic", annonce: "Voilà mon bilan de santé.", titre: "Diagnostic", mots: ["diagnostic", "etat de jarvis", "verification", "bilan"], ecranParDefaut: "droite" },
  { id: "reglages", annonce: "Voilà les réglages.", titre: "Réglages", mots: ["reglages", "parametres", "configuration", "options"], ecranParDefaut: "droite" },
];

export function pageInfo(id: PageId): PageInfo {
  return PAGES.find((p) => p.id === id)!;
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "'")
    .replace(/\b(l|d|j|n|qu)'/g, "")
    .replace(/[^a-z0-9&' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type PageCommand =
  | { action: "ouvrir"; pages: PageId[]; ecran?: ScreenName | "principal" }
  | { action: "fermer"; pages: PageId[] | "toutes" }
  | { action: "deplacer"; pages: PageId[]; ecran: ScreenName | "principal" };

function findPages(text: string): PageId[] {
  const found: PageId[] = [];
  for (const page of PAGES) {
    if (page.mots.some((mot) => new RegExp(`(^| )${mot.replace(/[&]/g, "\\&")}( |$)`).test(text))) found.push(page.id);
  }
  // « la page code de la course » : on évite les doublons évidents (rendu = code, pas autre chose).
  return found;
}

function findScreen(text: string): ScreenName | "principal" | undefined {
  if (/\b(gauche)\b/.test(text)) return "gauche";
  if (/\b(droite)\b/.test(text)) return "droite";
  if (/\b(centre|milieu|central)\b/.test(text)) return "centre";
  if (/\b(principal)\b/.test(text)) return "principal";
  return undefined;
}

/**
 * Comprend « ouvre l'ingénieur », « affiche la sécurité sur l'écran de droite »,
 * « ferme le code », « mets les performances à gauche », « ferme tout ».
 * Renvoie undefined si la phrase n'est pas une commande de page (elle part alors vers Claude).
 */
export function parsePageCommand(sentence: string): PageCommand | undefined {
  const text = normalize(sentence);
  if (text.split(" ").length > 14) return undefined;
  const close = /^(ferme|fermer|cache|cacher|enleve|retire|quitte)\b/.test(text);
  const open = /^(ouvre|ouvrir|affiche|afficher|montre|lance|passe en|passe sur|va sur|mode)\b/.test(text);
  const move = !open && /^(mets|met|place|deplace|bouge|envoie|passe)\b/.test(text);
  if (!close && !move && !open) return undefined;
  if (close && /\b(tout|toutes|tous les ecrans|toutes les pages)\b/.test(text)) return { action: "fermer", pages: "toutes" };
  // Une page doit être désignée comme page/écran/interface, ou par son nom seul après le verbe.
  const pages = findPages(text);
  if (pages.length === 0) return undefined;
  const isPageTalk = /\b(page|ecran|interface|mode|vue|onglet)\b/.test(text) || text.split(" ").length <= 7;
  if (!isPageTalk) return undefined;
  const ecran = findScreen(text);
  if (close) return { action: "fermer", pages };
  if (move && ecran) return { action: "deplacer", pages, ecran };
  if (move && !ecran) return undefined;
  return { action: "ouvrir", pages, ...(ecran ? { ecran } : {}) };
}

export interface DisplayLike {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  primary: boolean;
}

/** Nomme les écrans de gauche à droite. Avec un seul écran, tout est au centre. */
export function nameDisplays<T extends DisplayLike>(displays: T[]): Record<ScreenName | "principal", T> {
  const sorted = [...displays].sort((a, b) => a.bounds.x - b.bounds.x);
  const primary = displays.find((d) => d.primary) ?? sorted[0]!;
  if (sorted.length === 1) return { gauche: primary, centre: primary, droite: primary, principal: primary };
  if (sorted.length === 2) {
    const [a, b] = sorted as [T, T];
    return { gauche: a, droite: b, centre: primary, principal: primary };
  }
  // Trois écrans ou plus : le plus à gauche, celui du milieu (de préférence le principal), le plus à droite.
  const left = sorted[0]!;
  const right = sorted.at(-1)!;
  const middle = primary !== left && primary !== right ? primary : sorted[Math.floor(sorted.length / 2)]!;
  return { gauche: left, centre: middle, droite: right, principal: primary };
}
