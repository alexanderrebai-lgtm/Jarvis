/**
 * Tableau des capacités : tout ce que Jarvis sait faire, ce qui est actif chez
 * toi, et ce qu'il manque pour le reste. Avec une vingtaine de fonctions et
 * autant de groupes de réglages, on ne devine plus ce qui existe : cet écran le
 * dit, avec un bouton pour aller le configurer.
 */

export type EtatCapacite = "active" | "a-configurer" | "desactivee" | "materiel" | "toujours";

export interface Capacite {
  id: string;
  titre: string;
  /** Ce que ça fait, en une phrase. */
  quoi: string;
  /** Une phrase à dire pour l'essayer. */
  exemple: string;
  etat: EtatCapacite;
  /** Ce qu'il manque quand ce n'est pas actif. */
  manque?: string;
  /** Groupe de réglages où le configurer (id de groupe, ou « briefings » / « connecteurs »). */
  groupe?: string;
}

export interface ContexteCapacites {
  env: (nom: string) => string | undefined;
  briefings: number;
  connecteurs: number;
  documentsBibliotheque: number;
  motEveilActif: boolean;
  /** Noms des connecteurs ajoutés (pour reconnaître Screenpipe, Home Assistant…). */
  connecteurNoms?: string[];
}

export function capacites(c: ContexteCapacites): Capacite[] {
  const e = c.env;
  const rempli = (...noms: string[]) => noms.every((n) => !!e(n));
  const ecran = ["5", "10", "15"].includes(e("ECRAN_VEILLE") ?? "");
  const traceurUrl = !!e("VOITURE_TRACCAR_URL");
  const traceurAcces = !!e("VOITURE_TRACCAR_TOKEN") || (!!e("VOITURE_TRACCAR_EMAIL") && !!e("VOITURE_TRACCAR_MDP"));
  const reveilOn = (e("REVEIL") ?? "off") === "on";

  return [
    { id: "voix", titre: "Te parler", quoi: "Il t'écoute (« Hey Jarvis »), te répond à voix haute et reconnaît ta voix.", exemple: "« Hey Jarvis, quelle heure est-il ? »", etat: c.motEveilActif ? "active" : "a-configurer", ...(c.motEveilActif ? {} : { manque: "Le détecteur « Hey Jarvis » n'est pas chargé : vérifie le micro et la connexion au premier démarrage." }), groupe: "voix" },
    { id: "memoire", titre: "Se souvenir de toi", quoi: "Il retient ce que tu lui dis d'utile, et le relit à chaque conversation.", exemple: "« Retiens que je préfère le café sans sucre. »", etat: "toujours" },
    { id: "proactif", titre: "Penser à ta place", quoi: "De lui-même, aux bonnes heures : une note oubliée, le contexte avant un rendez-vous.", exemple: "(il te le dit tout seul)", etat: (e("RAPPEL_PROACTIF") ?? "on") === "off" ? "desactivee" : "active", groupe: "proactif" },
    { id: "amelioration", titre: "S'améliorer avec toi", quoi: "Chaque semaine, il relit ses échecs (corrections, reformulations, refus) et te propose des règles ; rien ne change sans ton accord.", exemple: "« Fais ta revue d'amélioration. »", etat: "toujours" },
    { id: "briefings", titre: "Briefings programmés", quoi: "Une recherche à heure fixe, lue à voix haute ou envoyée sur Telegram.", exemple: "« Chaque lundi à 8 h, l'actu des simulateurs de course. »", etat: c.briefings > 0 ? "active" : "a-configurer", ...(c.briefings > 0 ? {} : { manque: "Aucun briefing créé." }), groupe: "briefings" },
    { id: "google", titre: "Mails et agenda", quoi: "Il lit tes mails importants, te prévient des rendez-vous et gère ton agenda.", exemple: "« Qu'est-ce que j'ai demain ? »", etat: rempli("GOOGLE_REFRESH_TOKEN") ? "active" : "a-configurer", ...(rempli("GOOGLE_REFRESH_TOKEN") ? {} : { manque: "Connecte ton compte Google." }), groupe: "google" },
    { id: "reveil", titre: "Réveil", quoi: "Lever de soleil sur tes lampes, musique, puis le point de la journée.", exemple: "« Réveille-moi à 7 h 30. »", etat: !reveilOn ? "desactivee" : rempli("PLANNING_FICHIER") || rempli("REVEIL_HEURE") ? "active" : "a-configurer", ...(reveilOn && !(rempli("PLANNING_FICHIER") || rempli("REVEIL_HEURE")) ? { manque: "Indique un planning ou une heure habituelle." } : {}), groupe: "reveil" },
    { id: "spotify", titre: "Musique Spotify", quoi: "Il lance et pilote la musique sur ton PC.", exemple: "« Mets du jazz. »", etat: rempli("SPOTIFY_CLIENT_ID") ? "active" : "a-configurer", ...(rempli("SPOTIFY_CLIENT_ID") ? {} : { manque: "Crée une appli Spotify et colle son Client ID." }), groupe: "spotify" },
    { id: "maison", titre: "Maison connectée (Tapo)", quoi: "Il allume, éteint et règle tes ampoules et prises.", exemple: "« Mets la lumière du salon à 30 %. »", etat: rempli("TAPO_EMAIL", "TAPO_PASSWORD") ? "active" : "a-configurer", ...(rempli("TAPO_EMAIL", "TAPO_PASSWORD") ? {} : { manque: "Ajoute l'e-mail et le mot de passe du compte Tapo." }), groupe: "tapo" },
    { id: "cameras", titre: "Caméras de surveillance", quoi: "Détection de personne, dissuasion, clips, alertes sur ton téléphone.", exemple: "« Active la surveillance complète. »", etat: rempli("TAPO_CAMERAS", "TAPO_CAMERA_COMPTE", "TAPO_CAMERA_MOT_DE_PASSE") ? "active" : "a-configurer", ...(rempli("TAPO_CAMERAS", "TAPO_CAMERA_COMPTE", "TAPO_CAMERA_MOT_DE_PASSE") ? {} : { manque: "Indique tes caméras et leur compte." }), groupe: "cameras" },
    { id: "alertes", titre: "Alertes sur le téléphone", quoi: "Telegram : Jarvis t'envoie les alertes de la surveillance (avec photo) et tes briefings. En option, tu peux lui répondre par texte ou message vocal (questions seulement par défaut).", exemple: "(envoie-lui un vocal)", etat: rempli("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID") ? "active" : "a-configurer", ...(rempli("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID") ? {} : { manque: "Crée un bot Telegram (@BotFather) et trouve ta conversation." }), groupe: "alertes" },
    { id: "mobile", titre: "Jarvis sur ton téléphone", quoi: "Une application web à ajouter à l'écran d'accueil : discuter, état, maison, mémoire, journal. Contrôle complet par Tailscale, notifications push ; les réglages restent sur le PC.", exemple: "(ouvre l'appli sur ton téléphone)", etat: e("MOBILE_ACTIF") === "true" ? "active" : "desactivee", ...(e("MOBILE_ACTIF") === "true" ? {} : { manque: "Active-la, installe Tailscale (PC et téléphone), puis envoie-toi le lien d'appairage." }), groupe: "mobile" },
    { id: "satellites", titre: "Micros des autres pièces", quoi: "Un micro dans la cuisine ou la chambre envoie ta phrase à Jarvis et lit sa réponse.", exemple: "(le micro envoie « allume la lumière »)", etat: e("SATELLITE_ACTIF") === "true" ? "active" : "materiel", ...(e("SATELLITE_ACTIF") === "true" ? {} : { manque: "Il te faut un micro (module ESP32 ~15 €, Home Assistant Voice ~60 €…) ; puis active ce réglage." }), groupe: "satellites" },
    { id: "memoire-ecran", titre: "Mémoire de ce que tu as fait à l'écran", quoi: "« Qu'est-ce que je regardais mardi ? » via Screenpipe. Facultatif et très sensible : tout ce qui s'affiche est enregistré sur ton PC.", exemple: "« Qu'est-ce que je regardais mardi après-midi ? »", etat: c.connecteurNoms?.includes("memoire-ecran") ? "active" : "desactivee", ...(c.connecteurNoms?.includes("memoire-ecran") ? {} : { manque: "Facultatif : installe Screenpipe, puis ajoute le préréglage « memoire-ecran » dans Connecteurs." }), groupe: "connecteurs" },
    { id: "rangement", titre: "Mémoire qui se range", quoi: "Chaque semaine, Jarvis propose de fusionner les doublons et d'oublier le périmé ; tu valides, et tu peux annuler.", exemple: "« Range ma mémoire. »", etat: "toujours" },
    { id: "approbation", titre: "Accord avant les actions sensibles", quoi: "Pour une action à risque faite sans toi devant le PC, Jarvis te demande (PC, Telegram, téléphone) ; sans réponse, c'est refusé.", exemple: "(il te demande tout seul)", etat: (e("APPROBATION") ?? "off") === "off" ? "desactivee" : "active", groupe: "approbation" },
    { id: "relecture", titre: "Missions relues par un second agent", quoi: "Pour un travail important, un second agent en lecture seule relit avant de te le rendre.", exemple: "« Fais-moi ça en tâche de fond, avec relecture. »", etat: "toujours" },
    { id: "ecran", titre: "Regarder ton écran", quoi: "Il propose son aide quand il voit une erreur ou un blocage (et se tait en jeu).", exemple: "« Surveille mon écran. »", etat: ecran ? "active" : "desactivee", groupe: "general" },
    { id: "course", titre: "Ingénieur de course", quoi: "Radio de stand pendant Le Mans Ultimate ou F1 : pneus, carburant, écarts.", exemple: "(il se lance avec le jeu)", etat: "toujours" },
    { id: "sante-pc", titre: "Santé du PC", quoi: "Diagnostic, causes probables des plantages, optimisations réversibles.", exemple: "« Fais le bilan de santé du PC. »", etat: "toujours" },
    { id: "forme", titre: "Ma forme (montre)", quoi: "Pas, rythme cardiaque, sommeil reçus de ta montre, sans cloud.", exemple: "« Comment je vais ? »", etat: e("SANTE_ACTIVE") === "true" ? "active" : "desactivee", groupe: "sante" },
    { id: "voiture-suivi", titre: "Suivre la voiture (traceur GPS)", quoi: "Où elle est, si elle roule, batterie, kilométrage : pour une voiture sans services connectés.", exemple: "« Où est la voiture ? »", etat: traceurUrl && traceurAcces ? "active" : traceurUrl ? "a-configurer" : "materiel", ...(traceurUrl && traceurAcces ? {} : { manque: traceurUrl ? "Ajoute le jeton ou l'e-mail et le mot de passe Traccar." : "Il te faut un traceur GPS OBD et un serveur Traccar (voir docs/voiture.md)." }), groupe: "voiture-suivi" },
    { id: "voiture-obd", titre: "Diagnostic moteur (OBD)", quoi: "Codes défaut et mesures en direct de la voiture.", exemple: "« Lis les codes défaut. »", etat: "materiel", manque: "Un adaptateur OBD2 Bluetooth (~20 €) branché sous le volant." },
    { id: "travail", titre: "Espace de travail", quoi: "Plannings, documents et noms de l'équipe, avec pseudonymes.", exemple: "« Qui travaille mardi ? »", etat: rempli("TRAVAIL_DOSSIER") ? "active" : "a-configurer", ...(rempli("TRAVAIL_DOSSIER") ? {} : { manque: "Choisis le dossier de tes documents de travail." }), groupe: "travail" },
    { id: "bibliotheque", titre: "Bibliothèque", quoi: "Il cherche dans tes PDF et notices, avec la page à citer.", exemple: "« Dans mon manuel, comment purger les freins ? »", etat: c.documentsBibliotheque > 0 ? "active" : "a-configurer", ...(c.documentsBibliotheque > 0 ? {} : { manque: "Dépose des PDF ou des notices dans le dossier « bibliotheque » de Jarvis." }) },
    { id: "connecteurs", titre: "Connecteurs (outils en plus)", quoi: "Home Assistant, Notion, un dossier… ajoutés sans nouvelle version.", exemple: "(selon le connecteur)", etat: c.connecteurs > 0 ? "active" : "a-configurer", ...(c.connecteurs > 0 ? {} : { manque: "Aucun connecteur ajouté (facultatif)." }), groupe: "connecteurs" },
    { id: "ia-locale", titre: "IA locale (sans Internet)", quoi: "Il répond encore quand Claude est indisponible ou que tu coupes Internet.", exemple: "(automatique)", etat: rempli("OLLAMA_URL") || rempli("IA_LOCALE_MODELE") ? "active" : "a-configurer", ...(rempli("OLLAMA_URL") || rempli("IA_LOCALE_MODELE") ? {} : { manque: "Installe Ollama et choisis un modèle (facultatif)." }), groupe: "cerveau" },
    { id: "cout", titre: "Plafond de consommation", quoi: "Il compte ses appels à Claude et met en pause ses tâches automatiques au plafond.", exemple: "« Combien tu consommes ? »", etat: Number(e("USAGE_PLAFOND_JOUR")?.replace(",", ".")) > 0 ? "active" : "desactivee", groupe: "cout" },
    { id: "sauvegardes", titre: "Sauvegardes", quoi: "Copie chiffrée de tes données, pour ne rien perdre.", exemple: "« Fais une sauvegarde. »", etat: rempli("SAUVEGARDE_COPIE") ? "active" : "a-configurer", ...(rempli("SAUVEGARDE_COPIE") ? {} : { manque: "Choisis où copier tes sauvegardes (disque externe ou cloud)." }), groupe: "sauvegardes" },
  ];
}

export interface BilanCapacites {
  total: number;
  actives: number;
  aConfigurer: number;
  /** Les « à configurer » d'abord, ce sont les actions possibles. */
  aFaire: Capacite[];
}

export function bilan(liste: Capacite[]): BilanCapacites {
  const utiles = liste.filter((x) => x.etat !== "toujours");
  const actives = liste.filter((x) => x.etat === "active" || x.etat === "toujours").length;
  return { total: liste.length, actives, aConfigurer: utiles.filter((x) => x.etat === "a-configurer").length, aFaire: liste.filter((x) => x.etat === "a-configurer") };
}

/** Phrase pour la voix ou Claude : « qu'est-ce que tu sais faire ? ». */
export function phraseCapacites(liste: Capacite[]): string {
  const b = bilan(liste);
  const manquants = b.aFaire.slice(0, 5).map((x) => `${x.titre} (${x.manque ?? "à régler"})`).join(" ; ");
  return `Je sais faire ${b.total} choses ; ${b.actives} sont prêtes chez toi.${manquants ? ` À configurer : ${manquants}.` : " Tout ce qui demande un réglage est en place."} La liste détaillée est dans Réglages, en haut.`;
}
