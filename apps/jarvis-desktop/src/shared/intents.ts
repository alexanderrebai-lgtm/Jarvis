/**
 * Réflexes : les demandes simples et fréquentes sont comprises et exécutées sur
 * le PC, en moins d'une seconde, sans passer par Claude (lumières, musique,
 * minuteurs, réveil, surveillance…). Tout le reste part vers Claude.
 */

export type Intent =
  | { type: "lumiere"; cible: string; action?: "allumer" | "eteindre"; luminosite?: number; couleur?: string }
  | { type: "musique"; action: "lecture" | "pause" | "suivant" | "precedent" | "volume" | "reveil"; volume?: number; delta?: number; requete?: string }
  | { type: "minuteur"; secondes: number; libelle?: string }
  | { type: "minuteur_annuler" }
  | { type: "minuteurs" }
  | { type: "rappel"; dans: number; texte: string }
  | { type: "heure" }
  | { type: "date" }
  | { type: "reveil"; action: "debout" | "repousser" | "aucun" | "regler" | "quand" | "essai" | "arreter"; minutes?: number; jour?: "aujourdhui" | "demain"; heure?: string }
  | { type: "surveillance"; mode: "complete" | "simple" | "off" }
  | { type: "ne_pas_deranger"; actif: boolean }
  | { type: "mentor"; mode: "fais" | "avec" | "guide" }
  | { type: "voix"; action: "apprendre" | "oublier" | "etat" }
  | { type: "spotify"; action: "connecter" }
  | { type: "demonstration"; action: "debut" | "fin"; nom?: string }
  | { type: "sauvegarde" };

export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9%:' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NUMBERS: Record<string, number> = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  "dix-sept": 17, "dix-huit": 18, "dix-neuf": 19, vingt: 20, "vingt-cinq": 25, trente: 30, quarante: 40, "quarante-cinq": 45, cinquante: 50, soixante: 60, cent: 100, midi: 12, minuit: 0,
};

/** Remplace les nombres écrits en lettres par des chiffres (« dix minutes » → « 10 minutes »). */
export function digits(text: string): string {
  return text
    .replace(/\b(vingt|trente|quarante|cinquante)[ -]et[ -]un\b/g, (_m, t: string) => String(NUMBERS[t]! + 1))
    .replace(/\b(dix|vingt|trente|quarante|cinquante)-(sept|huit|neuf|cinq|deux|trois|quatre|six)\b/g, (_m, a: string, b: string) => String(NUMBERS[a]! + NUMBERS[b]!))
    .replace(/\b([a-z]+(?:-[a-z]+)?)\b/g, (word) => (word in NUMBERS && !["un", "une"].includes(word) ? String(NUMBERS[word]) : word))
    .replace(/\b(un|une) (heure|minute|seconde|quart|demi)/g, "1 $2");
}

/** Durée en secondes : « 10 minutes », « 1 h 30 », « 2 min 30 », « une demi-heure », « un quart d'heure ». */
export function parseDuration(text: string): number | undefined {
  const t = digits(fold(text));
  if (/\b(1 )?demi[ -]heure\b/.test(t)) return 1800;
  if (/\b1 quart d'?heure\b|\bquart d'?heure\b/.test(t)) return 900;
  const m = t.match(/(\d+)\s*(h|heures?)\s*(?:et\s*)?(demie|(\d+)\s*(?:min(?:utes?)?)?)?|(\d+)\s*(min|minutes?|mn)\s*(?:et\s*)?(\d+)?\s*(s|sec|secondes?)?|(\d+)\s*(s|sec|secondes?)\b/);
  if (!m) return undefined;
  if (m[1]) return Number(m[1]) * 3600 + (m[3] === "demie" ? 1800 : m[4] ? Number(m[4]) * 60 : 0);
  if (m[5]) return Number(m[5]) * 60 + (m[7] ? Number(m[7]) : 0);
  if (m[9]) return Number(m[9]);
  return undefined;
}

/** Heure : « 6 h 30 », « 6h30 », « 6:30 », « 7 heures et quart », « 7 heures moins le quart », « midi ». */
export function parseClock(text: string): string | undefined {
  const t = digits(fold(text));
  const pad = (n: number) => String(n).padStart(2, "0");
  let m = t.match(/\b(\d{1,2})\s*(?:heures?|h|:)\s*(?:(\d{1,2})|(et quart|et demie|moins le quart|moins quart))?/);
  if (!m) return undefined;
  let h = Number(m[1]);
  let min = m[2] ? Number(m[2]) : 0;
  if (m[3] === "et quart") min = 15;
  else if (m[3] === "et demie") min = 30;
  else if (m[3]?.startsWith("moins")) {
    h -= 1;
    min = 45;
  }
  if (h < 0 || h > 23 || min > 59) return undefined;
  if (/\b(du soir|de l'apres-midi|cet apres-midi|ce soir)\b/.test(t) && h < 12) h += 12;
  return `${pad(h)}:${pad(min)}`;
}

const COLORS: Record<string, string> = {
  rouge: "red", bleu: "blue", bleue: "blue", vert: "green", verte: "green", jaune: "yellow", blanc: "white", blanche: "white", "blanc chaud": "warmwhite", "blanc froid": "daylightwhite", chaud: "warmwhite", froid: "daylightwhite",
  orange: "#ff8a1f", violet: "#8b5cf6", violette: "#8b5cf6", rose: "#ff5fa2", cyan: "#22d3ee",
};

function lightIntent(t: string): Intent | undefined {
  const deviceWords = "(?:la |le |les |l')?(?:lumieres?|lampes?|ampoules?|prises?|lumiere)";
  const on = t.match(new RegExp(`^(?:allume|allumes|allumer|rallume)\\s+(.+)$`));
  const off = t.match(new RegExp(`^(?:eteins|eteint|eteindre|coupe|coupes)\\s+(.+)$`));
  const set = t.match(new RegExp(`^(?:mets|met|regle|passe|baisse|monte|tamise)\\s+(?:${deviceWords})?\\s*(?:du |de la |de l'|des |de |d')?(.*?)\\s+(?:a|en|au)\\s+(\\d{1,3}\\s*%|fond|blanc chaud|blanc froid|[a-z]+)$`));
  const target = (raw: string) => {
    const cleaned = raw
      .replace(new RegExp(`^${deviceWords}\\s*`), "")
      .replace(/^(du |de la |de l'|des |de |d'|dans le |dans la |au |a la |la |le |les |l')/, "")
      .replace(/\s*(stp|s'il te plait|merci|jarvis)$/, "")
      .trim();
    return cleaned;
  };
  if (on || off) {
    const raw = (on ?? off)![1]!;
    if (raw.split(" ").length > 5 || /\b(et|puis|ensuite|explique|dis)\b/.test(raw)) return undefined;
    if (!/(lumiere|lampe|ampoule|prise|salon|chambre|cuisine|bureau|tout|partout|simu|simulateur|plafonnier|led|guirlande|tele)/.test(raw)) return undefined;
    if (/\b(pc|ordinateur|ecran|camera|micro|programme|appli|application|logiciel|jeu)\b/.test(raw)) return undefined;
    const allWords = /^(tout|toutes? les (lumieres|lampes)|les lumieres|la lumiere|les lampes|partout)$/.test(raw);
    return { type: "lumiere", cible: allWords ? (raw.includes("lumiere") || raw.includes("lampe") ? "toutes les lumieres" : "tout") : target(raw) || "toutes les lumieres", action: on ? "allumer" : "eteindre" };
  }
  if (set && /(lumiere|lampe|ampoule|salon|chambre|cuisine|bureau)/.test(t)) {
    const value = set[2]!.trim();
    const cible = target(set[1] ?? "") || "toutes les lumieres";
    if (/^\d{1,3}\s*%$/.test(value)) return { type: "lumiere", cible, luminosite: Math.min(100, Number(value.replace(/\D/g, ""))) };
    if (value === "fond") return { type: "lumiere", cible, luminosite: 100 };
    const couleur = COLORS[value];
    if (couleur) return { type: "lumiere", cible, couleur };
  }
  if (/^(baisse|tamise) (la |les )?(lumiere|lumieres|lampes?)/.test(t)) return { type: "lumiere", cible: target(t.replace(/^(baisse|tamise) /, "")) || "toutes les lumieres", luminosite: 30 };
  return undefined;
}

function musicIntent(t: string): Intent | undefined {
  if (/^(mets|lance|joue) (la |ma )?playlist (du )?reveil$/.test(t)) return { type: "musique", action: "reveil" };
  const play = t.match(/^(?:mets|met|lance|joue)\s+(?:de la |la |une )?(?:musique|chanson|son)\b\s*(?:de |d')?(.*)$/);
  if (play) return { type: "musique", action: "lecture", ...(play[1]?.trim() ? { requete: play[1].trim() } : {}) };
  const playSomething = t.match(/^(?:mets|joue|lance)\s+(?:moi\s+)?(.+?)\s+sur spotify$/);
  if (playSomething) return { type: "musique", action: "lecture", requete: playSomething[1]!.trim() };
  if (/^(pause|mets (la musique )?(en )?pause|stop la musique|arrete la musique|coupe la musique)$/.test(t)) return { type: "musique", action: "pause" };
  if (/^(reprends|reprend|relance) (la )?(musique|lecture)$/.test(t)) return { type: "musique", action: "lecture" };
  if (/^(chanson|morceau|titre|piste) suivante?$|^(passe|zappe)( (a la|au))? (chanson|morceau|titre) suivante?$|^suivant$/.test(t)) return { type: "musique", action: "suivant" };
  if (/^(chanson|morceau|titre|piste) precedente?$|^precedent$/.test(t)) return { type: "musique", action: "precedent" };
  const volume = t.match(/^(?:mets |regle )?(?:le )?(?:volume|son)(?: de la musique)? (?:a )?(\d{1,3})\s*%?$/);
  if (volume) return { type: "musique", action: "volume", volume: Math.min(100, Number(volume[1])) };
  if (/^(monte|augmente) (le son|le volume|la musique)/.test(t)) return { type: "musique", action: "volume", delta: 15 };
  if (/^(baisse|diminue) (le son|le volume|la musique)/.test(t)) return { type: "musique", action: "volume", delta: -15 };
  return undefined;
}

function timerIntent(t: string, original: string): Intent | undefined {
  if (/^(annule|arrete|stop|coupe) (le |les )?(minuteurs?|chronos?|comptes? a rebours)$/.test(t)) return { type: "minuteur_annuler" };
  if (/^(quels? minuteurs?|combien de temps (reste|il reste)|il reste combien)/.test(t)) return { type: "minuteurs" };
  const timer = t.match(/^(?:mets|lance|demarre|programme|regle)?\s*(?:moi\s+)?(?:un |le )?(?:minuteur|chrono|compte a rebours|timer)\s*(?:de |pour |sur )?(.+)$/);
  if (timer) {
    const secondes = parseDuration(timer[1]!);
    if (!secondes) return undefined;
    // Le libellé garde l'écriture d'origine (accents compris).
    const label = timer[1]!.match(/\bpour\s+(.+)$/) ? original.match(/\bpour\s+(.+?)[\s.!?]*$/i)?.[1] : undefined;
    return { type: "minuteur", secondes, ...(label ? { libelle: label } : {}) };
  }
  const reminder = fold(original).match(/^rappelle(?:-| )moi dans (.+?) (?:de |d'|qu'il faut |que je dois |pour )(.+)$/);
  if (reminder) {
    const dans = parseDuration(reminder[1]!);
    if (dans) return { type: "rappel", dans, texte: original.replace(/^.*?\b(de |d'|qu'il faut |que je dois |pour )/i, "").trim() };
  }
  return undefined;
}

function alarmIntent(t: string): Intent | undefined {
  if (/^(je suis (debout|leve|levee|reveille|reveillee)|c'est bon je suis (debout|leve|reveille)|debout|ok je me leve|je me leve)$/.test(t)) return { type: "reveil", action: "debout" };
  const snooze = t.match(/^(encore|laisse(?:-| )moi|donne(?:-| )moi) (?:encore )?(\d+|cinq|dix|quelques) ?(minutes?|min)?|^(laisse-moi dormir|laisse moi dormir|pas maintenant|plus tard)$/);
  if (snooze) {
    const n = snooze[2] ? Number(digits(snooze[2])) : 9;
    return { type: "reveil", action: "repousser", minutes: Number.isFinite(n) && n > 0 ? Math.min(30, n) : 9 };
  }
  if (/^(arrete|coupe|stop) (le )?reveil$/.test(t)) return { type: "reveil", action: "arreter" };
  if (/^(pas de reveil|ne me reveille pas|annule le reveil|desactive le reveil)( (demain|ce matin|aujourd'hui))?$/.test(t)) return { type: "reveil", action: "aucun", jour: /aujourd'hui|ce matin/.test(t) ? "aujourdhui" : "demain" };
  if (/^(a quelle heure|quand) (tu me reveilles|est le reveil|sonne le reveil|je me leve)/.test(t) || /^(prochain reveil|c'est quoi mon reveil)/.test(t)) return { type: "reveil", action: "quand" };
  if (/^(teste|essaie|essaye) (le )?reveil$/.test(t)) return { type: "reveil", action: "essai" };
  const set = t.match(/^(?:reveille(?:-| )moi|mets (?:le |un )?reveil|programme (?:le |un )?reveil|regle (?:le |un )?reveil)\s+(?:demain\s+)?(?:a\s+)?(.+?)(\s+demain)?$/);
  if (set) {
    const heure = parseClock(set[1]!);
    if (heure) return { type: "reveil", action: "regler", heure, jour: /aujourd'hui/.test(t) ? "aujourdhui" : "demain" };
  }
  return undefined;
}

/** Comprend une demande simple. Renvoie undefined pour tout le reste (qui part vers Claude). */
export function parseIntent(sentence: string): Intent | undefined {
  const t = fold(sentence).replace(/^(jarvis |stp |s'il te plait )/, "").replace(/( stp| s'il te plait| merci| jarvis)$/, "");
  if (!t || t.split(" ").length > 16) return undefined;
  if (/^(quelle heure (est-il|il est)|il est quelle heure|l'heure)$/.test(t)) return { type: "heure" };
  if (/^(quel jour (sommes-nous|on est|est-on)|on est quel jour|quelle est la date|c'est quel jour)$/.test(t)) return { type: "date" };
  if (/^(active |mets |passe en |lance )?(la )?surveillance (complete|totale|maximale|renforcee)$|^(mode|passe en mode) (surveillance complete|absence|alerte)$/.test(t)) return { type: "surveillance", mode: "complete" };
  if (/^(active |mets |lance )(la )?surveillance( simple)?$|^surveillance simple$/.test(t)) return { type: "surveillance", mode: "simple" };
  if (/^(desactive|coupe|arrete|enleve) (la )?surveillance$/.test(t)) return { type: "surveillance", mode: "off" };
  if (/^(mode |active le mode )?(ne pas deranger|silencieux|calme)$/.test(t)) return { type: "ne_pas_deranger", actif: true };
  if (/^(desactive|enleve|quitte) (le )?(mode )?(ne pas deranger|silencieux|calme)$/.test(t)) return { type: "ne_pas_deranger", actif: false };
  if (/^(fais(-| )le( pour moi)?|mode (fais|faire)( a ma place)?|fais a ma place)$/.test(t)) return { type: "mentor", mode: "fais" };
  if (/^(fais(-| )le avec moi|mode (avec moi|ensemble)|on le fait ensemble)$/.test(t)) return { type: "mentor", mode: "avec" };
  if (/^(guide(-| )moi|mode (guide|mentor|apprentissage|prof)|apprends(-| )moi a le faire)$/.test(t)) return { type: "mentor", mode: "guide" };
  if (/^(apprends|enregistre|memorise) ma voix$/.test(t)) return { type: "voix", action: "apprendre" };
  if (/^(oublie|efface) ma voix$/.test(t)) return { type: "voix", action: "oublier" };
  if (/^(tu reconnais ma voix|est-ce que tu reconnais ma voix)$/.test(t)) return { type: "voix", action: "etat" };
  if (/^(connecte|relie|branche) (mon compte )?spotify$/.test(t)) return { type: "spotify", action: "connecter" };
  if (/^(lance|fais) (une |la )?sauvegarde( maintenant)?$|^sauvegarde (tout|maintenant)$/.test(t)) return { type: "sauvegarde" };
  const demo = t.match(/^(?:regarde,? |regarde )?(?:je vais te montrer|je te montre|je vais t'apprendre|regarde comment je fais) (?:comment )?(?:on |je )?(?:fait |fais |faire )?(.*)$/);
  if (demo) return { type: "demonstration", action: "debut", ...(demo[1]?.trim() ? { nom: demo[1].trim() } : {}) };
  if (/^(c'est fini|voila c'est tout|voila c'est fini|fin de la demonstration|termine la demonstration|j'ai fini de te montrer)$/.test(t)) return { type: "demonstration", action: "fin" };
  return alarmIntent(t) ?? timerIntent(t, sentence) ?? lightIntent(t) ?? musicIntent(t);
}

/** « 10 minutes », « 1 heure 30 », « 45 secondes » à dire à voix haute. */
export function sayDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h) parts.push(`${h} heure${h > 1 ? "s" : ""}`);
  if (m) parts.push(`${m} minute${m > 1 ? "s" : ""}`);
  if (s && !h) parts.push(`${s} seconde${s > 1 ? "s" : ""}`);
  return parts.join(" ") || "0 seconde";
}
