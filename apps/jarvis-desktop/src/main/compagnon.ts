import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { JsonStore, newId } from "@muscu/jarvis/src/store.js";

/**
 * Compagnon de jeu : Jarvis repère tout seul le jeu qui tourne (Call of Duty,
 * EA FC, GTA, Flight Simulator, aventure, course…), en déduit le genre et
 * ouvre la page adaptée. Deux façons de reconnaître un jeu :
 *   1. le nom du processus, dans le catalogue ci-dessous ;
 *   2. le dossier d'installation : tout exécutable lancé depuis une
 *      bibliothèque de jeux (Steam, Epic, EA, Ubisoft, Xbox, Rockstar, GOG,
 *      Riot, Battle.net) est un jeu, même inconnu du catalogue.
 *
 * Les noms de processus du catalogue viennent de mémoire : certains peuvent
 * changer avec une mise à jour du jeu. Le repérage par dossier rattrape la
 * plupart des cas, et tu peux ajouter un jeu à la main (réglage JEUX_PERSO).
 */

export type Genre = "course" | "vol" | "tir" | "sport" | "monde-ouvert" | "aventure" | "strategie" | "survie" | "moba" | "autre";

export interface JeuCatalogue {
  nom: string;
  genre: Genre;
  processus: string[];
}

export const CATALOGUE: JeuCatalogue[] = [
  // Course (l'Ingénieur de course lit la télémétrie de F1 et Le Mans Ultimate)
  { nom: "Le Mans Ultimate", genre: "course", processus: ["Le Mans Ultimate.exe", "LMU.exe"] },
  { nom: "F1", genre: "course", processus: ["F1_26.exe", "F1_2026.exe", "F1_25.exe", "F1_24.exe", "F1_23.exe", "F1_22.exe"] },
  { nom: "Assetto Corsa", genre: "course", processus: ["acs.exe", "AssettoCorsa.exe"] },
  { nom: "Assetto Corsa Competizione", genre: "course", processus: ["AC2-Win64-Shipping.exe"] },
  { nom: "iRacing", genre: "course", processus: ["iRacingSim64DX11.exe"] },
  { nom: "Forza Horizon 5", genre: "course", processus: ["ForzaHorizon5.exe"] },
  { nom: "Forza Motorsport", genre: "course", processus: ["forza_steamworks_release_final.exe", "ForzaMotorsport.exe"] },
  { nom: "Gran Turismo 7", genre: "course", processus: ["GranTurismo7.exe"] },
  { nom: "Need for Speed", genre: "course", processus: ["NeedForSpeedUnbound.exe", "NeedForSpeedHeat.exe"] },
  { nom: "rFactor 2", genre: "course", processus: ["rFactor2.exe"] },
  { nom: "BeamNG.drive", genre: "course", processus: ["BeamNG.drive.x64.exe"] },
  { nom: "Euro Truck Simulator 2", genre: "course", processus: ["eurotrucks2.exe"] },
  // Tir
  { nom: "Call of Duty", genre: "tir", processus: ["cod.exe", "ModernWarfare.exe", "BlackOpsColdWar.exe", "s2_mp64_ship.exe", "s2_sp64_ship.exe", "cod24-cod.exe", "BlackOps6.exe", "Warzone.exe", "iw8.exe"] },
  { nom: "Counter-Strike 2", genre: "tir", processus: ["cs2.exe"] },
  { nom: "Valorant", genre: "tir", processus: ["VALORANT-Win64-Shipping.exe"] },
  { nom: "Apex Legends", genre: "tir", processus: ["r5apex.exe", "r5apex_dx12.exe"] },
  { nom: "Fortnite", genre: "tir", processus: ["FortniteClient-Win64-Shipping.exe"] },
  { nom: "Overwatch 2", genre: "tir", processus: ["Overwatch.exe"] },
  { nom: "Rainbow Six Siege", genre: "tir", processus: ["RainbowSix.exe", "RainbowSix_Vulkan.exe", "RainbowSix_BE.exe"] },
  { nom: "Battlefield", genre: "tir", processus: ["bf1.exe", "bfv.exe", "BF2042.exe", "bf6.exe"] },
  { nom: "Helldivers 2", genre: "tir", processus: ["helldivers2.exe"] },
  { nom: "DOOM", genre: "tir", processus: ["DOOMEternalx64vk.exe", "DOOMx64vk.exe"] },
  // Sport
  { nom: "EA Sports FC", genre: "sport", processus: ["FC26.exe", "FC25.exe", "FC24.exe", "FIFA23.exe", "FIFA22.exe", "FIFA21.exe", "FIFA20.exe"] },
  { nom: "eFootball", genre: "sport", processus: ["eFootball.exe", "PES2021.exe"] },
  { nom: "NBA 2K", genre: "sport", processus: ["NBA2K26.exe", "NBA2K25.exe", "NBA2K24.exe"] },
  { nom: "Madden NFL", genre: "sport", processus: ["Madden25.exe", "Madden24.exe"] },
  { nom: "Rocket League", genre: "sport", processus: ["RocketLeague.exe"] },
  // Monde ouvert
  { nom: "GTA V", genre: "monde-ouvert", processus: ["GTA5.exe", "GTA5_Enhanced.exe"] },
  { nom: "Red Dead Redemption 2", genre: "monde-ouvert", processus: ["RDR2.exe"] },
  { nom: "Cyberpunk 2077", genre: "monde-ouvert", processus: ["Cyberpunk2077.exe"] },
  { nom: "Assassin's Creed", genre: "monde-ouvert", processus: ["ACShadows.exe", "ACValhalla.exe", "ACOdyssey.exe", "ACOrigins.exe", "ACMirage.exe"] },
  { nom: "Starfield", genre: "monde-ouvert", processus: ["Starfield.exe"] },
  { nom: "Elden Ring", genre: "monde-ouvert", processus: ["eldenring.exe"] },
  // Aventure et jeux de rôle
  { nom: "The Witcher 3", genre: "aventure", processus: ["witcher3.exe"] },
  { nom: "Baldur's Gate 3", genre: "aventure", processus: ["bg3.exe", "bg3_dx11.exe"] },
  { nom: "Skyrim", genre: "aventure", processus: ["SkyrimSE.exe", "TESV.exe"] },
  { nom: "Fallout 4", genre: "aventure", processus: ["Fallout4.exe"] },
  { nom: "Hogwarts Legacy", genre: "aventure", processus: ["HogwartsLegacy.exe"] },
  { nom: "God of War", genre: "aventure", processus: ["GoW.exe", "GoWR.exe"] },
  { nom: "Horizon", genre: "aventure", processus: ["HorizonZeroDawn.exe", "HorizonForbiddenWest.exe"] },
  { nom: "Tomb Raider", genre: "aventure", processus: ["SOTTR.exe", "ROTTR.exe", "TombRaider.exe"] },
  { nom: "The Last of Us", genre: "aventure", processus: ["tlou-i.exe", "tlou-ii.exe"] },
  { nom: "Zelda", genre: "aventure", processus: ["Ryujinx.exe", "yuzu.exe"] },
  { nom: "Hollow Knight", genre: "aventure", processus: ["hollow_knight.exe"] },
  // Simulation de vol
  { nom: "Microsoft Flight Simulator", genre: "vol", processus: ["FlightSimulator.exe", "FlightSimulator2024.exe"] },
  { nom: "X-Plane", genre: "vol", processus: ["X-Plane.exe"] },
  { nom: "DCS World", genre: "vol", processus: ["DCS.exe"] },
  { nom: "Elite Dangerous", genre: "vol", processus: ["EliteDangerous64.exe"] },
  { nom: "Star Citizen", genre: "vol", processus: ["StarCitizen.exe"] },
  { nom: "Prepar3D", genre: "vol", processus: ["Prepar3D.exe"] },
  // Stratégie
  { nom: "Civilization", genre: "strategie", processus: ["CivilizationVI.exe", "CivilizationVII.exe", "CivilizationV.exe"] },
  { nom: "Age of Empires", genre: "strategie", processus: ["AoE2DE_s.exe", "AoE4.exe", "RelicCardinal.exe"] },
  { nom: "Total War", genre: "strategie", processus: ["Warhammer3.exe", "Warhammer2.exe", "Total War Warhammer III.exe"] },
  { nom: "Stellaris", genre: "strategie", processus: ["stellaris.exe"] },
  { nom: "Cities: Skylines", genre: "strategie", processus: ["Cities.exe", "CitiesSkylines.exe"] },
  { nom: "StarCraft II", genre: "strategie", processus: ["SC2_x64.exe"] },
  // Survie et bac à sable
  { nom: "Minecraft", genre: "survie", processus: ["Minecraft.Windows.exe", "Minecraft.exe"] },
  { nom: "Rust", genre: "survie", processus: ["RustClient.exe"] },
  { nom: "Valheim", genre: "survie", processus: ["valheim.exe"] },
  { nom: "Palworld", genre: "survie", processus: ["Palworld-Win64-Shipping.exe"] },
  { nom: "Terraria", genre: "survie", processus: ["Terraria.exe"] },
  { nom: "DayZ", genre: "survie", processus: ["DayZ_x64.exe"] },
  // MOBA
  { nom: "League of Legends", genre: "moba", processus: ["League of Legends.exe"] },
  { nom: "Dota 2", genre: "moba", processus: ["dota2.exe"] },
];

export interface ProcessInfo {
  /** Nom du processus, « .exe » compris. */
  name: string;
  /** Chemin complet de l'exécutable, quand on le connaît. */
  path?: string;
}

export interface JeuDetecte {
  nom: string;
  genre: Genre;
  /** Comment on l'a reconnu. */
  source: "catalogue" | "dossier" | "perso";
  processus: string;
  /** Lanceur de jeux d'où il vient (Steam, Epic…), si repéré par le dossier. */
  lanceur?: string;
}

// ---------- Genres : ce que propose la page ----------

export interface ActionRapide {
  libelle: string;
  /** Question envoyée au coach. */
  question: string;
  /** Cette action a besoin de voir l'écran (capture). */
  ecran?: boolean;
}

export interface ProfilGenre {
  genre: Genre;
  libelle: string;
  accroche: string;
  actions: ActionRapide[];
  /** Les astuces sur ce genre peuvent gâcher l'histoire : on demande « sans spoiler » par défaut. */
  histoire: boolean;
}

export const PROFILS: Record<Genre, ProfilGenre> = {
  course: {
    genre: "course",
    libelle: "Course et simulation auto",
    accroche: "L'ingénieur de course te parle en piste ; ici, mise au point et progression.",
    histoire: false,
    actions: [
      { libelle: "Mise au point", question: "Donne-moi une mise au point de départ pour cette voiture et ce circuit, et dis-moi quoi changer si elle sous-vire ou sur-vire." },
      { libelle: "Trajectoire du circuit", question: "Explique-moi les points clés du circuit : freinages, points de corde, où gagner du temps." },
      { libelle: "Progresser", question: "Quels sont les 3 exercices les plus efficaces pour gagner en régularité et en vitesse sur ce jeu ?" },
      { libelle: "Réglages du volant", question: "Quels réglages de volant et de retour de force conseilles-tu pour ce jeu ?" },
    ],
  },
  vol: {
    genre: "vol",
    libelle: "Simulation de vol",
    accroche: "Check-lists, procédures et météo pour voler proprement.",
    histoire: false,
    actions: [
      { libelle: "Check-list de l'avion", question: "Donne-moi la check-list de démarrage, décollage et atterrissage pour l'appareil que je pilote." },
      { libelle: "Préparer un vol", question: "Aide-moi à préparer un vol : choix de la route, altitude de croisière, carburant et météo à vérifier." },
      { libelle: "Atterrissage", question: "Mes atterrissages sont ratés : donne-moi la méthode pas à pas (vitesse d'approche, pente, arrondi)." },
      { libelle: "Je suis perdu", question: "Regarde mon écran et dis-moi ce qui ne va pas dans mon cockpit ou mon vol.", ecran: true },
    ],
  },
  tir: {
    genre: "tir",
    libelle: "Jeu de tir",
    accroche: "Meilleurs réglages, armes et progression, sans te distraire en pleine partie.",
    histoire: false,
    actions: [
      { libelle: "Meilleures armes", question: "Quelles sont les meilleures armes et classes en ce moment sur ce jeu, avec les accessoires recommandés ?" },
      { libelle: "Réglages sensibilité et vidéo", question: "Quels réglages de sensibilité, de champ de vision et de graphismes pour viser mieux et avoir plus d'images par seconde ?" },
      { libelle: "Progresser", question: "Quels sont les 3 points qui me feraient le plus progresser (placement, viser, jeu d'équipe) ?" },
      { libelle: "Nouveautés de la saison", question: "Qu'est-ce qui a changé dans la dernière mise à jour ou saison de ce jeu ?" },
    ],
  },
  sport: {
    genre: "sport",
    libelle: "Jeu de sport",
    accroche: "Tactiques, effectif et astuces pour gagner plus de matchs.",
    histoire: false,
    actions: [
      { libelle: "Tactique conseillée", question: "Donne-moi une tactique et des consignes d'équipe efficaces en ce moment sur ce jeu." },
      { libelle: "Gestes et contrôles", question: "Rappelle-moi les gestes techniques et combinaisons de touches qui font la différence (dribbles, tirs, passes, défense)." },
      { libelle: "Gérer mon équipe", question: "Comment bien gérer mon effectif, mes transferts et mes finances dans ce jeu ?" },
      { libelle: "Nouveautés", question: "Qu'est-ce qui a changé dans la dernière mise à jour de ce jeu ?" },
    ],
  },
  "monde-ouvert": {
    genre: "monde-ouvert",
    libelle: "Monde ouvert",
    accroche: "Un coup de main pour une mission, un secret ou un moyen de gagner de l'argent.",
    histoire: true,
    actions: [
      { libelle: "Je suis bloqué", question: "Je suis bloqué dans ma mission ou mon exploration actuelle. Regarde mon écran et aide-moi sans me gâcher la suite.", ecran: true },
      { libelle: "Gagner de l'argent", question: "Quelles sont les meilleures façons de gagner de l'argent ou des ressources rapidement dans ce jeu ?" },
      { libelle: "Secrets et collectibles", question: "Où trouver les secrets, collectibles ou activités que les joueurs ratent le plus souvent ?" },
      { libelle: "Que faire maintenant ?", question: "D'après mes notes de progression, que me conseilles-tu de faire ensuite ?" },
    ],
  },
  aventure: {
    genre: "aventure",
    libelle: "Aventure et jeu de rôle",
    accroche: "Des indices, jamais plus que ce que tu veux savoir.",
    histoire: true,
    actions: [
      { libelle: "Je suis bloqué", question: "Je suis bloqué. Regarde mon écran et donne-moi un petit indice d'abord, sans spoiler.", ecran: true },
      { libelle: "Choisir mon build", question: "Aide-moi à choisir ou améliorer mon build (classe, compétences, équipement) sans me spoiler l'histoire." },
      { libelle: "Quête en cours", question: "D'après mes notes, comment avancer dans ma quête actuelle ? Un indice d'abord." },
      { libelle: "Rien à rater", question: "Quels éléments ou quêtes sont ratables définitivement dans ce jeu, sans révéler l'histoire ?" },
    ],
  },
  strategie: {
    genre: "strategie",
    libelle: "Stratégie",
    accroche: "Ouvertures, économie et plan de partie.",
    histoire: false,
    actions: [
      { libelle: "Plan de partie", question: "Donne-moi un plan de partie efficace pour ce jeu : ouverture, économie, montée en puissance." },
      { libelle: "Analyser ma situation", question: "Regarde mon écran et dis-moi ce que tu ferais à ma place.", ecran: true },
      { libelle: "Erreurs de débutant", question: "Quelles sont les erreurs de débutant les plus courantes sur ce jeu et comment les éviter ?" },
      { libelle: "Meilleures stratégies du moment", question: "Quelles sont les stratégies ou factions les plus fortes en ce moment ?" },
    ],
  },
  survie: {
    genre: "survie",
    libelle: "Survie et bac à sable",
    accroche: "Recettes, bases et ressources.",
    histoire: false,
    actions: [
      { libelle: "Premiers pas", question: "Que faire dans les premières heures de ce jeu pour bien démarrer ?" },
      { libelle: "Recettes et ressources", question: "Où trouver les ressources rares et comment fabriquer les objets importants ?" },
      { libelle: "Construire ma base", question: "Donne-moi des conseils pour construire et défendre une base efficacement." },
      { libelle: "Je suis bloqué", question: "Regarde mon écran et dis-moi comment m'en sortir.", ecran: true },
    ],
  },
  moba: {
    genre: "moba",
    libelle: "MOBA et jeu en équipe",
    accroche: "Objectifs, builds et lecture de partie.",
    histoire: false,
    actions: [
      { libelle: "Build conseillé", question: "Quel est le meilleur build, ordre de compétences et runes pour mon personnage en ce moment ?" },
      { libelle: "Objectifs et timings", question: "Quels sont les objectifs et les timings à surveiller pour gagner la partie ?" },
      { libelle: "Progresser", question: "Quels sont les 3 axes pour grimper : placement, économie, vision ?" },
      { libelle: "Patch du moment", question: "Qu'est-ce qui a changé dans le dernier patch ?" },
    ],
  },
  autre: {
    genre: "autre",
    libelle: "Jeu vidéo",
    accroche: "Pose-moi n'importe quelle question sur ce jeu.",
    histoire: true,
    actions: [
      { libelle: "Bien démarrer", question: "Donne-moi les conseils essentiels pour bien démarrer ce jeu sans me spoiler." },
      { libelle: "Je suis bloqué", question: "Regarde mon écran et aide-moi avec un petit indice, sans spoiler.", ecran: true },
      { libelle: "Réglages conseillés", question: "Quels réglages graphiques et de contrôle conseilles-tu pour ce jeu sur mon PC ?" },
      { libelle: "Nouveautés", question: "Qu'est-ce qui a changé dans la dernière mise à jour de ce jeu ?" },
    ],
  },
};

export function profil(genre: Genre): ProfilGenre {
  return PROFILS[genre];
}

export function estGenre(valeur: string): valeur is Genre {
  return Object.prototype.hasOwnProperty.call(PROFILS, valeur);
}

// ---------- Reconnaître un jeu ----------

/** Dossiers de bibliothèques de jeux : « …\<dossier>\<nom du jeu>\… ». */
const BIBLIOTHEQUES: Array<{ lanceur: string; re: RegExp }> = [
  { lanceur: "Steam", re: /\\steamapps\\common\\([^\\]+)\\/i },
  { lanceur: "Epic Games", re: /\\Epic Games\\([^\\]+)\\/i },
  { lanceur: "EA", re: /\\(?:EA Games|Electronic Arts|EA Desktop)\\(?!EA Desktop\\)([^\\]+)\\/i },
  { lanceur: "Ubisoft", re: /\\Ubisoft Game Launcher\\games\\([^\\]+)\\/i },
  { lanceur: "Xbox", re: /\\XboxGames\\([^\\]+)\\/i },
  { lanceur: "Rockstar", re: /\\Rockstar Games\\([^\\]+)\\/i },
  { lanceur: "GOG", re: /\\GOG Galaxy\\Games\\([^\\]+)\\/i },
  { lanceur: "Riot", re: /\\Riot Games\\([^\\]+)\\/i },
  { lanceur: "Battle.net", re: /\\Battle\.net\\([^\\]+)\\/i },
];

/** Exécutables d'un dossier de jeu qui ne sont pas le jeu lui-même. */
const PAS_UN_JEU_EXE = /(crash|helper|launcher|anti-?cheat|eac|battleye|unins|setup|redist|vcredist|dxsetup|ue4prereq|prereq|cef|webhelper|bootstrap|report|updater|installer|overlay|service|benchmark|editor|config|dotnet|vc_redist|touchup|activation|cleanup|cmd|worker|server)/i;
/** Dossiers de « jeux » qui sont en réalité des outils. */
const PAS_UN_JEU_DOSSIER = /(redistributable|steamworks|wallpaper engine|steam controller|soundpad|proton|steamvr|\bsdk\b|dedicated server|(launcher|tools?)$)/i;

const MOTS_GENRE: Array<{ genre: Genre; re: RegExp }> = [
  { genre: "course", re: /(racing|rally|motorsport|grand prix|drift|kart|speed|formula|gt\b|nascar|trackmania|truck|car\b|cars\b|moto)/i },
  { genre: "vol", re: /(flight|aviation|aircraft|airline|x-plane|aerofly|helicopter|space sim|pilot)/i },
  { genre: "sport", re: /(football|soccer|fifa|\bfc\b|nba|nfl|nhl|mlb|tennis|golf|rugby|basket|hockey|cricket|wrestling|boxing|ufc|madden|pes\b|efootball)/i },
  { genre: "tir", re: /(call of duty|warfare|warzone|shooter|battlefield|counter-?strike|valorant|doom|halo|crysis|far cry|titanfall|rainbow|apex|overwatch|fps|sniper|gun)/i },
  { genre: "strategie", re: /(civilization|age of|total war|command|conquer|strategy|stellaris|tycoon|city|cities|starcraft|xcom|anno|crusader|hearts of iron|europa)/i },
  { genre: "survie", re: /(survival|craft|rust|ark\b|forest|valheim|terraria|dayz|subnautica|raft|palworld|satisfactory|factory)/i },
  { genre: "moba", re: /(league of legends|dota|smite|heroes of the storm)/i },
  { genre: "monde-ouvert", re: /(grand theft|gta|red dead|open world|cyberpunk|assassin|watch dogs|saints row|just cause|mafia|sleeping dogs|elden|starfield)/i },
  { genre: "aventure", re: /(witcher|skyrim|elder scrolls|fallout|baldur|dragon age|mass effect|souls|tomb raider|uncharted|zelda|adventure|rpg|quest|legend|saga|tales|kingdom|sekiro|hades|hollow)/i },
];

export function genreDepuisNom(nom: string): Genre {
  for (const { genre, re } of MOTS_GENRE) if (re.test(nom)) return genre;
  return "autre";
}

function nomPropre(dossier: string): string {
  return dossier.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Jeux déclarés dans JEUX_PERSO : « Nom=processus.exe=genre » séparés par « ; » ou « , ». */
export function parsePerso(texte: string | undefined): JeuCatalogue[] {
  const jeux: JeuCatalogue[] = [];
  for (const brut of (texte ?? "").split(/[;\n]/)) {
    const [nom, processus, genre] = brut.split("=").map((s) => s.trim());
    if (!nom || !processus) continue;
    jeux.push({ nom, genre: genre && estGenre(genre) ? genre : genreDepuisNom(nom), processus: processus.split(/[,|]/).map((s) => s.trim()).filter(Boolean) });
  }
  return jeux;
}

/** Une ligne « "Nom.exe","C:\chemin\Nom.exe" » (PowerShell) ou « "Nom.exe","1234",… » (tasklist). */
export function parseProcessus(csv: string): ProcessInfo[] {
  const out: ProcessInfo[] = [];
  for (const ligne of csv.split(/\r?\n/)) {
    const champs = [...ligne.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1]!.replace(/""/g, '"'));
    const name = champs[0];
    if (!name || !/\.exe$/i.test(name)) continue;
    const chemin = champs[1] && /[\\/]/.test(champs[1]) ? champs[1] : undefined;
    out.push(chemin ? { name, path: chemin } : { name });
  }
  return out;
}

/** Quels jeux tournent ? Catalogue d'abord, puis bibliothèques de jeux. */
export function detecterJeux(processus: ProcessInfo[], perso: JeuCatalogue[] = []): JeuDetecte[] {
  const parNom = new Map<string, { jeu: JeuCatalogue; source: "catalogue" | "perso" }>();
  for (const jeu of CATALOGUE) for (const p of jeu.processus) parNom.set(p.toLowerCase(), { jeu, source: "catalogue" });
  for (const jeu of perso) for (const p of jeu.processus) parNom.set(p.toLowerCase(), { jeu, source: "perso" });

  const trouves = new Map<string, JeuDetecte>();
  const ajoute = (j: JeuDetecte) => {
    const cle = j.nom.toLowerCase();
    if (!trouves.has(cle)) trouves.set(cle, j);
  };
  for (const p of processus) {
    const connu = parNom.get(p.name.toLowerCase());
    if (connu) ajoute({ nom: connu.jeu.nom, genre: connu.jeu.genre, source: connu.source, processus: p.name });
  }
  for (const p of processus) {
    if (!p.path || parNom.has(p.name.toLowerCase()) || PAS_UN_JEU_EXE.test(p.name)) continue;
    for (const { lanceur, re } of BIBLIOTHEQUES) {
      const dossier = p.path.match(re)?.[1];
      if (!dossier || PAS_UN_JEU_DOSSIER.test(dossier)) continue;
      const nom = nomPropre(dossier);
      // Déjà reconnu par le catalogue sous un nom proche : on ne le double pas.
      if ([...trouves.values()].some((t) => t.nom.toLowerCase() === nom.toLowerCase())) break;
      ajoute({ nom, genre: genreDepuisNom(`${nom} ${p.name}`), source: "dossier", processus: p.name, lanceur });
      break;
    }
  }
  return [...trouves.values()];
}

// ---------- Surveillance ----------

export class JeuxDetecteur {
  private timer: NodeJS.Timeout | undefined;
  private running: JeuDetecte[] = [];
  private principal: JeuDetecte | undefined;

  constructor(
    private readonly options: {
      /** Noms de processus supplémentaires (JEUX_PROCESSUS) : comptent comme des jeux « autre ». */
      supplementaires?: string[];
      perso?: JeuCatalogue[];
      onChange: (running: JeuDetecte[], principal: JeuDetecte | undefined) => void;
      /** Liste des processus (tests, ou fichier de test). */
      list?: () => Promise<string>;
      intervalMs?: number;
    },
  ) {}

  get active(): boolean {
    return this.running.length > 0;
  }
  /** Noms des jeux qui tournent. */
  get games(): string[] {
    return this.running.map((j) => j.nom);
  }
  get jeux(): JeuDetecte[] {
    return this.running;
  }
  /** Le jeu « du moment » : le premier lancé, tant qu'il tourne. */
  get current(): JeuDetecte | undefined {
    return this.principal;
  }

  /** Une passe de détection à partir d'une liste de processus. */
  ingerer(procs: ProcessInfo[]): void {
    const supp = (this.options.supplementaires ?? []).filter(Boolean).map((p): JeuCatalogue => ({ nom: p.replace(/\.exe$/i, ""), genre: "autre", processus: [p] }));
    const next = detecterJeux(procs, [...supp, ...(this.options.perso ?? [])]);
    if (next.map((j) => j.nom).join("|") === this.running.map((j) => j.nom).join("|")) return;
    this.running = next;
    const garde = this.principal && next.find((j) => j.nom === this.principal!.nom);
    this.principal = garde ?? [...next].sort((a, b) => (a.source === "dossier" ? 1 : 0) - (b.source === "dossier" ? 1 : 0))[0];
    this.options.onChange(next, this.principal);
  }

  start(): void {
    if (process.platform !== "win32" && !this.options.list) return;
    const tick = async () => {
      try {
        this.ingerer(parseProcessus(await (this.options.list ?? listerProcessus)()));
      } catch {
        // Liste indisponible un instant : on réessaiera.
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), this.options.intervalMs ?? 10_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

/** Test en direct : un fichier remplace la vraie liste de processus. */
export function listeDepuisFichier(chemin: string): () => Promise<string> {
  return async () => {
    try {
      return readFileSync(chemin, "utf8");
    } catch {
      return "";
    }
  };
}

const SCRIPT_PS = "Get-Process | Where-Object { $_.Path } | ForEach-Object { '\"' + $_.ProcessName + '.exe\",\"' + $_.Path + '\"' }";

function executer(fichier: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(fichier, args, { windowsHide: true, timeout, maxBuffer: 8_000_000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

/** PowerShell donne le chemin de chaque programme ; sinon, tasklist (noms seulement). */
async function listerProcessus(): Promise<string> {
  try {
    const sortie = await executer("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SCRIPT_PS], 12_000);
    if (sortie.trim()) return sortie;
  } catch {
    // PowerShell lent ou bloqué : tasklist suffit pour le catalogue.
  }
  return executer("tasklist", ["/fo", "csv", "/nh"], 8_000);
}

// ---------- Sessions et notes ----------

export interface Session {
  id: string;
  jeu: string;
  genre: Genre;
  debut: string;
  fin?: string;
  minutes?: number;
}

export interface NoteJeu {
  id: string;
  jeu: string;
  texte: string;
  date: string;
}

interface Donnees {
  sessions: Session[];
  notes: NoteJeu[];
}

export class CompagnonStore {
  private readonly store: JsonStore<Donnees>;

  constructor(dataDir: string, private readonly maintenant: () => Date = () => new Date()) {
    this.store = new JsonStore<Donnees>(dataDir, "compagnon", () => ({ sessions: [], notes: [] }));
  }

  debut(jeu: string, genre: Genre): Session {
    const ouverte = this.store.read().sessions.find((s) => s.jeu === jeu && !s.fin);
    if (ouverte) return ouverte;
    const s: Session = { id: newId("jeu"), jeu, genre, debut: this.maintenant().toISOString() };
    this.store.update((d) => ({ ...d, sessions: [...d.sessions, s].slice(-300) }));
    return s;
  }

  fin(jeu: string): Session | undefined {
    let resultat: Session | undefined;
    const fin = this.maintenant();
    this.store.update((d) => ({
      ...d,
      sessions: d.sessions.map((s) => {
        if (s.jeu !== jeu || s.fin) return s;
        resultat = { ...s, fin: fin.toISOString(), minutes: Math.max(0, Math.round((fin.getTime() - new Date(s.debut).getTime()) / 60_000)) };
        return resultat;
      }),
    }));
    return resultat;
  }

  /** Sessions restées « en cours » après un arrêt brutal du PC : on les clôt au démarrage. */
  clorePerimees(): void {
    this.store.update((d) => ({ ...d, sessions: d.sessions.map((s) => (s.fin ? s : { ...s, fin: s.debut, minutes: 0 })) }));
  }

  sessions(limite = 20): Session[] {
    return this.store.read().sessions.slice(-limite).reverse();
  }

  /** Minutes jouées sur ce jeu (sessions terminées + session en cours). */
  minutes(jeu: string): number {
    const now = this.maintenant().getTime();
    return this.store.read().sessions.filter((s) => s.jeu === jeu).reduce((total, s) => total + (s.minutes ?? (s.fin ? 0 : Math.max(0, Math.round((now - new Date(s.debut).getTime()) / 60_000)))), 0);
  }

  notes(jeu: string): NoteJeu[] {
    return this.store.read().notes.filter((n) => n.jeu === jeu).reverse();
  }

  ajouteNote(jeu: string, texte: string): NoteJeu {
    const propre = texte.trim().slice(0, 500);
    if (!propre) throw new Error("Écris ce que tu veux retenir (où tu en es, ce que tu as trouvé…).");
    const n: NoteJeu = { id: newId("nj"), jeu, texte: propre, date: this.maintenant().toISOString() };
    this.store.update((d) => ({ ...d, notes: [...d.notes, n].slice(-500) }));
    return n;
  }

  supprimeNote(id: string): boolean {
    const avant = this.store.read().notes.length;
    return this.store.update((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) })).notes.length < avant;
  }

  /** Jeux joués, du plus récent au plus ancien, avec le temps total. */
  recents(limite = 8): Array<{ jeu: string; genre: Genre; minutes: number; dernier: string }> {
    const vus = new Map<string, { jeu: string; genre: Genre; minutes: number; dernier: string }>();
    for (const s of this.store.read().sessions) {
      const e = vus.get(s.jeu) ?? { jeu: s.jeu, genre: s.genre, minutes: 0, dernier: s.debut };
      e.minutes += s.minutes ?? 0;
      e.dernier = s.debut;
      e.genre = s.genre;
      vus.set(s.jeu, e);
    }
    return [...vus.values()].sort((a, b) => b.dernier.localeCompare(a.dernier)).slice(0, limite);
  }
}

export function dureeLisible(minutes: number): string {
  if (minutes < 1) return "moins d'une minute";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** Prompt du coach : jamais de spoiler sans accord, court, adapté au genre. */
export function promptCoach(options: { jeu: string; genre: Genre; question: string; notes: NoteJeu[]; sansSpoiler: boolean; ecran: boolean; proprietaire: string }): string {
  const p = profil(options.genre);
  const notes = options.notes.slice(0, 6).map((n) => `- ${n.texte}`).join("\n");
  return [
    `Tu es le compagnon de jeu de ${options.proprietaire}. Il joue à « ${options.jeu} » (${p.libelle}).`,
    options.sansSpoiler
      ? "RÈGLE ABSOLUE : aucun spoiler. Donne d'abord un indice discret ; ne révèle la solution complète que s'il la demande explicitement. Ne dévoile ni rebondissement, ni sort d'un personnage."
      : "Il accepte les spoilers : tu peux être direct.",
    options.ecran ? "Fais UNE capture d'écran (ecran_capture) pour voir où il en est, et appuie-toi dessus. N'exécute aucune action, ne clique sur rien." : "",
    notes ? `Ses notes de progression :\n${notes}` : "",
    "Cherche sur Internet (WebSearch, WebFetch) si ta réponse dépend de la version du jeu, d'un patch récent ou de données précises ; privilégie les sources récentes et cite-les en bas en une ligne.",
    "Réponds en français, tutoiement, court (moins de 900 caractères), en Markdown simple : une phrase d'abord, puis 2 à 4 points concrets.",
    `Question : ${options.question}`,
  ].filter(Boolean).join("\n\n");
}

/** Une phrase pour Jarvis et pour le téléphone. */
export function phraseJeu(courant: JeuDetecte | undefined, minutes: number, recents: Array<{ jeu: string; minutes: number }>): string {
  if (courant) return `${courant.nom} est en cours (${profil(courant.genre).libelle.toLowerCase()}), depuis ${dureeLisible(minutes)} sur cette installation de Jarvis.`;
  if (recents.length === 0) return "Aucun jeu détecté pour l'instant, et je n'en ai pas encore vu tourner.";
  return `Aucun jeu en cours. Dernier jeu : ${recents[0]!.jeu} (${dureeLisible(recents[0]!.minutes)} au total).`;
}
