import path from "node:path";
import { createSdkMcpServer, tool as sdkTool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import type { ActionLog, FileVersions } from "./actions.js";
import type { BackupService } from "./backup.js";
import type { Budget } from "./budget.js";
import type { CheckResult } from "./diagnostic.js";
import type { Microcontrollers } from "./electronics.js";
import type { Garage } from "./garage.js";
import type { Lab } from "./lab.js";
import { addNotebookEntry, readNotebook } from "./lab.js";
import type { Learning } from "./learning.js";
import type { Library } from "./library/index.js";
import type { LocalAI } from "./local-ai.js";
import { dtcFamily, ELM_INIT, parseDtcResponse, parseMonitorStatus, parsePid, PIDS } from "./obd.js";
import type { DispositionStore } from "./pages/dispositions.js";
import { PAGES, type PageId } from "./pages/catalog.js";
import type { Papers } from "./papers.js";
import type { Procedures } from "./procedures.js";
import type { Literature, LiteratureSource } from "./research/literature.js";
import type { WakeUp } from "./reveil/alarm.js";
import type { Routines, RoutineStep } from "./routines.js";
import type { BackgroundTasks } from "./tasks.js";
import type { Veille } from "./veille.js";

/**
 * Deuxième boîte à outils de Jarvis (chargée à la demande par Claude) :
 * dispositions, réveil, Spotify, tâches de fond, recherche, bibliothèque,
 * mentor, labo, veille, routines, garage et OBD, procédures, IA locale,
 * électronique, papiers, budget, traçabilité, sauvegardes, diagnostic.
 */

export interface PlusHost {
  workspace: string;
  dispositions: DispositionStore;
  applyDisposition: (nom: string) => string;
  saveCurrentDisposition: (nom: string) => string;
  wake: WakeUp;
  spotify: {
    connected: () => boolean;
    connect: () => Promise<string>;
    play: (requete?: string) => Promise<string>;
    control: (action: "pause" | "suivant" | "precedent" | "volume", value?: number) => Promise<string>;
    wakePlaylist: () => Promise<string>;
    setWakePlaylist: (link: string) => Promise<string>;
    addToWake: (requetes: string[]) => Promise<string>;
    addCurrentToWake: () => Promise<string>;
  };
  tasks: BackgroundTasks;
  launchTask: (titre: string, consigne: string, page?: "travail" | "rd" | "code" | "accueil") => string;
  launchResearch: (sujet: string, objectif: string | undefined, profondeur: "rapide" | "normale" | "poussee") => string;
  literature: Literature;
  library: Library;
  learning: Learning;
  lab: Lab;
  veille: Veille;
  routines: Routines;
  runRoutine: (nom: string) => Promise<string>;
  timers: { add: (seconds: number, label?: string) => string; list: () => unknown };
  garage: Garage;
  obd: (commands: string[], port?: string) => Promise<Record<string, string>>;
  findObd: () => Promise<{ port: string; baud: number; version: string } | null>;
  procedures: Procedures;
  runProcedure: (nom: string, parametres?: string) => string;
  localAI: LocalAI;
  micro: Microcontrollers;
  serialMonitor: (port: string, baud: number, seconds: number, send?: string) => Promise<string>;
  budget: Budget;
  papers: Papers;
  actions: ActionLog;
  versions: FileVersions;
  recycle: (paths: string[]) => Promise<string>;
  readWorkFile: (file: string, feuille?: string) => Promise<string>;
  unmaskFile: (file: string) => Promise<string>;
  backups: BackupService;
  listBackups: () => unknown;
  restoreFromBackup: (archive: string, entry: string, destination: string) => Promise<string>;
  diagnostic: () => Promise<CheckResult[]>;
  showImage: (titre: string, file: string, page?: PageId) => Promise<void>;
}

type ToolResult = { content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>; isError?: boolean };
const text = (value: unknown): ToolResult => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 1).slice(0, 60_000) }] });
const failure = (error: unknown): ToolResult => ({ content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true });
const safe =
  <A,>(fn: (args: A) => Promise<ToolResult> | ToolResult) =>
  async (args: A): Promise<ToolResult> => {
    try {
      return await fn(args);
    } catch (error) {
      return failure(error);
    }
  };
const RO = { annotations: { readOnlyHint: true } };

const PAGE_IDS = PAGES.map((p) => p.id) as [PageId, ...PageId[]];
const SLOT = z.enum(["gauche", "centre", "droite"]);

const STEP = z.union([
  z.object({ type: z.literal("lumieres"), cible: z.string(), action: z.enum(["allumer", "eteindre"]).optional(), luminosite: z.number().min(1).max(100).optional(), couleur: z.string().optional() }),
  z.object({ type: z.literal("surveillance"), mode: z.enum(["complete", "simple", "off"]) }),
  z.object({ type: z.literal("disposition"), nom: z.string() }),
  z.object({ type: z.literal("pages"), action: z.literal("fermer_tout") }),
  z.object({ type: z.literal("dire"), texte: z.string() }),
  z.object({ type: z.literal("ne_pas_deranger"), actif: z.boolean() }),
  z.object({ type: z.literal("musique"), action: z.enum(["lecture", "pause", "reveil"]), requete: z.string().optional() }),
  z.object({ type: z.literal("resume"), quoi: z.enum(["demain", "journee", "absence"]) }),
  z.object({ type: z.literal("ecrans_veille") }),
  z.object({ type: z.literal("attendre"), secondes: z.number().min(1).max(600) }),
]);

export function plusTools(h: PlusHost) {
  return [
    // ---------- Écrans ----------
    sdkTool("dispositions_lister", "Dispositions d'écrans enregistrées (ensembles de pages qui s'ouvrent ensemble, chacune à sa place : gauche, centre, droite).", {}, safe(async () => text(h.dispositions.list())), RO),
    sdkTool(
      "disposition_enregistrer",
      "Crée ou modifie une disposition : 1 à 3 pages, chacune à gauche, au centre ou à droite (avec un seul écran : moitiés ou tiers ; pendant une partie, l'écran du milieu reste au jeu). Sans « pages », enregistre la disposition actuelle.",
      { nom: z.string(), pages: z.array(z.object({ page: z.enum(PAGE_IDS), ecran: SLOT })).max(3).optional(), mots: z.array(z.string()).optional().describe("Autres noms à l'oral") },
      safe(async ({ nom, pages, mots }) => (pages?.length ? text(h.dispositions.save({ nom, pages, ...(mots ? { mots } : {}) })) : text(h.saveCurrentDisposition(nom)))),
    ),
    sdkTool("disposition_supprimer", "Supprime une disposition.", { nom: z.string() }, safe(async ({ nom }) => text(h.dispositions.remove(nom) ? "Supprimée." : "Introuvable."))),
    sdkTool("disposition_appliquer", "Ouvre les pages d'une disposition à leur place.", { nom: z.string() }, safe(async ({ nom }) => text(h.applyDisposition(nom)))),

    // ---------- Réveil et Spotify ----------
    sdkTool("reveil_etat", "Prochain réveil (heure, raison : planning, heure habituelle, réglage ponctuel), état actuel et réglages ponctuels.", {}, safe(async () => text({ ...h.wake.status(), reglagesPonctuels: h.wake.overrides() })), RO),
    sdkTool(
      "reveil_regler",
      "Règle le réveil d'un jour précis (heure « HH:MM »), le supprime pour ce jour (aucun), ou revient à l'automatique (automatique). Date au format AAAA-MM-JJ.",
      { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), heure: z.string().regex(/^\d{2}:\d{2}$/).optional(), aucun: z.boolean().optional(), automatique: z.boolean().optional() },
      safe(async ({ date, heure, aucun, automatique }) => {
        const next = automatique ? await h.wake.clearOverride(date) : await h.wake.setOverride({ date, ...(heure ? { heure } : {}), ...(aucun ? { aucun: true } : {}) });
        return text({ prochain: next ? { date: next.date, heure: next.heure, raison: next.raison } : "aucun réveil prévu" });
      }),
    ),
    sdkTool("reveil_essayer", "Fait sonner le réveil maintenant (musique, puis message du matin quand Alex dit « je suis debout »).", {}, safe(async () => (await h.wake.test(), text("Le réveil sonne.")))),
    sdkTool("spotify_connecter", "Relie le compte Spotify d'Alex (ouvre la page de connexion dans son navigateur).", {}, safe(async () => text(await h.spotify.connect()))),
    sdkTool("spotify_lecture", "Lance de la musique sur l'appli Spotify du PC : un titre, un artiste, un album ou une playlist (recherche), ou reprend la lecture sans requête.", { requete: z.string().optional() }, safe(async ({ requete }) => text(await h.spotify.play(requete)))),
    sdkTool("spotify_commande", "Pause, titre suivant ou précédent, volume (0 à 100).", { action: z.enum(["pause", "suivant", "precedent", "volume"]), volume: z.number().min(0).max(100).optional() }, safe(async ({ action, volume }) => text(await h.spotify.control(action, volume)))),
    sdkTool("spotify_playlist_reveil", "La playlist du réveil (créée si besoin avec des titres doux puis entraînants).", {}, safe(async () => text(await h.spotify.wakePlaylist()))),
    sdkTool("spotify_playlist_reveil_choisir", "Utilise une playlist existante pour le réveil (lien open.spotify.com ou URI spotify:playlist:…).", { lien: z.string() }, safe(async ({ lien }) => text(await h.spotify.setWakePlaylist(lien)))),
    sdkTool("spotify_reveil_ajouter", "Ajoute des titres à la playlist du réveil : par recherche (« artiste titre »), ou le titre en cours si en_cours est vrai.", { requetes: z.array(z.string()).optional(), en_cours: z.boolean().optional() }, safe(async ({ requetes, en_cours }) => text(en_cours ? await h.spotify.addCurrentToWake() : await h.spotify.addToWake(requetes ?? [])))),

    // ---------- Tâches de fond ----------
    sdkTool(
      "tache_lancer",
      "Lance une mission longue en tâche de fond (analyse de nombreux fichiers, projet complet, longue préparation) : tu réponds tout de suite à Alex, et la tâche s'annonce quand elle est finie. La consigne doit être complète et autonome (la tâche ne voit pas cette conversation).",
      { titre: z.string(), consigne: z.string(), page: z.enum(["travail", "rd", "code", "accueil"]).optional() },
      safe(async ({ titre, consigne, page }) => text(`Tâche lancée (${h.launchTask(titre, consigne, page)}).`)),
    ),
    sdkTool("taches_lister", "Tâches de fond : en cours, finies (avec leur résultat), échouées.", { nombre: z.number().int().min(1).max(30).optional() }, safe(async ({ nombre }) => text(h.tasks.list(nombre ?? 10).map((t) => ({ ...t, resultat: t.resultat?.slice(0, 2000) })))), RO),
    sdkTool("tache_annuler", "Arrête une tâche de fond.", { id: z.string() }, safe(async ({ id }) => text(h.tasks.cancel(id) ? "Annulée." : "Introuvable ou déjà finie."))),

    // ---------- Recherche ----------
    sdkTool(
      "litterature_chercher",
      "Cherche des articles scientifiques : arXiv, Semantic Scholar, OpenAlex, PubMed. Renvoie titre, auteurs, année, DOI, lien, résumé, citations. Pour des faits scientifiques, préfère ceci au web.",
      { requete: z.string().describe("En anglais de préférence"), sources: z.array(z.enum(["arxiv", "openalex", "pubmed", "semanticscholar"])).optional(), nombre: z.number().int().min(1).max(25).optional(), depuis: z.number().int().min(1900).max(2100).optional().describe("Année minimale") },
      safe(async ({ requete, sources, nombre, depuis }) => text(await h.literature.search(requete, { ...(sources ? { sources: sources as LiteratureSource[] } : {}), ...(nombre ? { limit: nombre } : {}), ...(depuis ? { since: depuis } : {}) }))),
      RO,
    ),
    sdkTool(
      "recherche_approfondie",
      "Lance une recherche approfondie en tâche de fond (sous-questions, web, littérature scientifique, bibliothèque, recoupements, calculs) qui écrit un rapport sourcé avec niveaux de confiance dans Documents\\Jarvis\\recherches, puis l'annonce.",
      { sujet: z.string(), objectif: z.string().optional(), profondeur: z.enum(["rapide", "normale", "poussee"]).optional() },
      safe(async ({ sujet, objectif, profondeur }) => text(`Recherche lancée (${h.launchResearch(sujet, objectif, profondeur ?? "normale")}). Je préviens Alex à la fin.`)),
    ),

    // ---------- Bibliothèque ----------
    sdkTool("bibliotheque_chercher", "Cherche dans la bibliothèque d'Alex (ses PDF, manuels, notices, notes du dossier bibliotheque) : passages avec fichier et page, à citer ainsi « (manuel.pdf, p. 12) ».", { question: z.string(), nombre: z.number().int().min(1).max(15).optional() }, safe(async ({ question, nombre }) => text(await h.library.search(question, nombre ?? 6))), RO),
    sdkTool("bibliotheque_etat", "Documents de la bibliothèque et état de l'index.", {}, safe(async () => text({ ...h.library.status(), documents: h.library.documents().slice(0, 200) })), RO),
    sdkTool("bibliotheque_indexer", "Réindexe la bibliothèque maintenant (après l'ajout de documents dans le dossier).", {}, safe(async () => text(await h.library.scan()))),

    // ---------- Mentor ----------
    sdkTool("mentor_mode", "Règle la façon d'aider Alex : fais (tu fais à sa place), avec (tu fais avec lui, étape par étape), guide (il apprend à faire seul : méthode, indices, questions).", { mode: z.enum(["fais", "avec", "guide"]) }, safe(async ({ mode }) => (h.learning.setMode(mode), text(`Mode : ${mode}.`)))),
    sdkTool(
      "parcours_creer",
      "Crée un parcours d'apprentissage par étapes (objectif, ressources, exercice pratique par étape), écrit dans Documents\\Jarvis\\apprentissage. Conçois-le d'abord : étapes courtes, du concret, des exercices sur les vrais projets d'Alex.",
      { sujet: z.string(), objectif: z.string(), niveau: z.string(), etapes: z.array(z.object({ titre: z.string(), objectif: z.string(), ressources: z.array(z.string()).optional(), exercice: z.string().optional() })).min(1).max(30) },
      safe(async (input) => text(h.learning.createPath(input))),
    ),
    sdkTool("parcours_etat", "Parcours en cours (avancement, prochaine étape), ou le détail d'un parcours.", { sujet: z.string().optional() }, safe(async ({ sujet }) => text(sujet ? h.learning.getPath(sujet) ?? "Aucun parcours à ce nom." : h.learning.listPaths())), RO),
    sdkTool("parcours_valider", "Marque une étape d'un parcours comme faite (numéro à partir de 1), avec une note.", { sujet: z.string(), etape: z.number().int().min(1), note: z.string().optional() }, safe(async ({ sujet, etape, note }) => text(h.learning.completeStep(sujet, etape, note)))),
    sdkTool("revision_ajouter", "Ajoute des fiches de révision (question, réponse) sur un sujet ; elles reviendront selon la répétition espacée.", { sujet: z.string(), fiches: z.array(z.object({ question: z.string(), reponse: z.string() })).min(1).max(50) }, safe(async ({ sujet, fiches }) => text(`${h.learning.addCards(sujet, fiches)} fiche(s) ajoutée(s).`))),
    sdkTool("revisions_du_jour", "Fiches à réviser aujourd'hui. Pose la question, attends la réponse d'Alex, puis note avec revision_noter.", { sujet: z.string().optional() }, safe(async ({ sujet }) => text(h.learning.due(sujet))), RO),
    sdkTool("revision_noter", "Note une réponse de révision de 0 (oublié) à 5 (parfait).", { id: z.string(), note: z.number().int().min(0).max(5) }, safe(async ({ id, note }) => text(h.learning.grade(id, note)))),

    // ---------- Labo ----------
    sdkTool(
      "labo_python",
      "Exécute du Python dans le labo (numpy, scipy, sympy, pandas, matplotlib, pint, et jarvis_labo : matériaux, poutres, coefficients de sécurité, impression 3D, couples de serrage, électronique). Les figures matplotlib sont enregistrées et renvoyées. Utilise-le pour tout calcul important, au lieu d'estimer.",
      { code: z.string(), delai_secondes: z.number().int().min(5).max(1800).optional() },
      safe(async ({ code, delai_secondes }) => {
        const r = await h.lab.run(code, (delai_secondes ?? 120) * 1000);
        const { readFile } = await import("node:fs/promises");
        const images = await Promise.all(r.figures.slice(0, 3).map(async (f) => ({ type: "image" as const, data: (await readFile(f)).toString("base64"), mimeType: "image/png" })));
        return { content: [{ type: "text", text: [r.stdout && `Sortie :\n${r.stdout.slice(-20_000)}`, r.stderr && `Erreurs :\n${r.stderr.slice(-6000)}`, r.figures.length && `Figures : ${r.figures.join(", ")}`, r.timedOut && "(arrêté : délai dépassé)"].filter(Boolean).join("\n\n") || "Terminé sans sortie." }, ...images], ...(r.code !== 0 ? { isError: true } : {}) };
      }),
    ),
    sdkTool("labo_preparer", "Prépare (ou met à jour) l'environnement Python du labo, et installe des paquets en plus si besoin (cadquery, scikit-learn…).", { paquets: z.array(z.string()).optional() }, safe(async ({ paquets }) => text(paquets?.length ? await h.lab.install(paquets) : await h.lab.setup()))),
    sdkTool(
      "cahier_ajouter",
      "Ajoute une entrée datée au cahier d'expériences d'un projet (projets/<projet>/CAHIER.md) : hypothèse, protocole, résultats, conclusion.",
      { projet: z.string(), titre: z.string(), hypothese: z.string().optional(), protocole: z.string().optional(), resultats: z.string().optional(), conclusion: z.string().optional() },
      safe(async ({ projet, ...entry }) => text(`Noté dans ${addNotebookEntry(path.join(h.workspace, "projets", projet), entry)}.`)),
    ),
    sdkTool("cahier_lire", "Lit le cahier d'expériences d'un projet.", { projet: z.string() }, safe(async ({ projet }) => text(readNotebook(path.join(h.workspace, "projets", projet)) ?? "Pas encore de cahier pour ce projet.")), RO),

    // ---------- Veille ----------
    sdkTool("veille_du_jour", "Résumé de la veille du jour (IA, simulation, travail, actualité française), préparé à partir des flux suivis. force=true pour le refaire.", { force: z.boolean().optional() }, safe(async ({ force }) => text((await h.veille.digest(force)) ?? "Rien de neuf dans les flux pour l'instant."))),
    sdkTool("veille_titres", "Derniers titres d'une catégorie de flux (france, ia, simulation, travail, science, autre).", { categorie: z.string().optional(), heures: z.number().int().min(1).max(168).optional() }, safe(async ({ categorie, heures }) => text(h.veille.recent(heures ?? 24, categorie).slice(0, 40))), RO),
    sdkTool(
      "veille_reglages",
      "Sujets et sources (flux RSS/Atom) suivis par la veille : en ajouter ou en retirer.",
      { ajouter_sujets: z.array(z.string()).optional(), retirer_sujets: z.array(z.string()).optional(), ajouter_sources: z.array(z.object({ nom: z.string(), url: z.string().url(), categorie: z.enum(["france", "ia", "simulation", "travail", "science", "autre"]) })).optional(), retirer_sources: z.array(z.string()).optional() },
      safe(async (a) => {
        const sujets = h.veille.setTopics(a.ajouter_sujets, a.retirer_sujets);
        const sources = h.veille.setSources(a.ajouter_sources, a.retirer_sources);
        return text({ sujets, sources });
      }),
    ),

    // ---------- Routines et minuteurs ----------
    sdkTool("routines_lister", "Routines (phrases qui déclenchent une suite d'actions : « bonne nuit », « je pars »…).", {}, safe(async () => text(h.routines.list())), RO),
    sdkTool(
      "routine_enregistrer",
      "Crée ou modifie une routine : nom, phrases de déclenchement, étapes (lumieres, surveillance, disposition, pages, dire, ne_pas_deranger, musique, resume, ecrans_veille, attendre).",
      { nom: z.string(), declencheurs: z.array(z.string()).min(1), etapes: z.array(STEP).min(1).max(20) },
      safe(async (input) => text(h.routines.save(input as { nom: string; declencheurs: string[]; etapes: RoutineStep[] }))),
    ),
    sdkTool("routine_supprimer", "Supprime une routine.", { nom: z.string() }, safe(async ({ nom }) => text(h.routines.remove(nom) ? "Supprimée." : "Introuvable."))),
    sdkTool("routine_lancer", "Lance une routine maintenant.", { nom: z.string() }, safe(async ({ nom }) => text(await h.runRoutine(nom)))),
    sdkTool("minuteur", "Lance un minuteur (secondes) avec un libellé, ou liste les minuteurs en cours.", { secondes: z.number().int().min(1).max(86_400).optional(), libelle: z.string().optional() }, safe(async ({ secondes, libelle }) => text(secondes ? h.timers.add(secondes, libelle) : h.timers.list()))),

    // ---------- Garage et OBD ----------
    sdkTool("vehicules", "Véhicules d'Alex avec kilométrage estimé et entretiens à prévoir.", {}, safe(async () => text(h.garage.vehicles().map((v) => ({ ...v, kmEstime: h.garage.estimatedKm(v), aFaire: h.garage.due(v.nom).filter((d) => d.etat !== "ok") })))), RO),
    sdkTool(
      "vehicule_enregistrer",
      "Ajoute un véhicule, ou met à jour ses informations (si le nom existe déjà).",
      { nom: z.string(), marque: z.string().optional(), modele: z.string().optional(), annee: z.number().int().optional(), moteur: z.string().optional(), kilometrage: z.number().int().min(0).optional(), immatriculation: z.string().optional(), notes: z.string().optional() },
      safe(async ({ nom, kilometrage, ...rest }) => {
        const existing = h.garage.find(nom);
        if (existing) {
          const updated = h.garage.updateVehicle(nom, rest);
          return text(kilometrage !== undefined ? h.garage.setMileage(updated.nom, kilometrage) : updated);
        }
        return text(h.garage.addVehicle({ nom, kilometrage: kilometrage ?? 0, ...rest }));
      }),
    ),
    sdkTool("kilometrage", "Nouveau relevé du compteur d'un véhicule.", { vehicule: z.string(), km: z.number().int().min(0) }, safe(async ({ vehicule, km }) => text(h.garage.setMileage(vehicule, km)))),
    sdkTool(
      "entretien_ajouter",
      "Note une intervention (vidange, plaquettes, pneus, courroie…) : date, kilométrage, détails, pièces, coût.",
      { vehicule: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), km: z.number().int().min(0), operation: z.string(), details: z.string().optional(), pieces: z.array(z.string()).optional(), cout: z.number().optional() },
      safe(async ({ vehicule, ...input }) => text(h.garage.addService(vehicule, input))),
    ),
    sdkTool("entretien_historique", "Historique des interventions d'un véhicule.", { vehicule: z.string() }, safe(async ({ vehicule }) => text(h.garage.history(vehicule))), RO),
    sdkTool(
      "entretien_plan",
      "Définit le plan d'entretien d'un véhicule (opérations avec intervalle en km et/ou en mois). Cherche d'abord les préconisations du constructeur pour ce modèle et ce moteur, et dis d'où elles viennent.",
      { vehicule: z.string(), operations: z.array(z.object({ operation: z.string(), intervalleKm: z.number().int().optional(), intervalleMois: z.number().int().optional() })).min(1) },
      safe(async ({ vehicule, operations }) => text(h.garage.setPlan(vehicule, operations))),
    ),
    sdkTool(
      "obd_codes_defaut",
      "Lit les codes défaut de la voiture par l'adaptateur ELM327 (prise OBD, contact mis) : codes confirmés, en attente, et témoin moteur. Ensuite, cherche la signification exacte pour le modèle d'Alex.",
      { port: z.string().optional().describe("COM3… (détecté sinon)") },
      safe(async ({ port }) => {
        const r = await h.obd([...ELM_INIT, "0101", "03", "07"], port);
        const confirmes = parseDtcResponse(r["03"] ?? "", 0x43);
        const enAttente = parseDtcResponse(r["07"] ?? "", 0x47);
        return text({ temoin: parseMonitorStatus(r["0101"] ?? ""), confirmes: confirmes.map((c) => ({ code: c, famille: dtcFamily(c) })), enAttente: enAttente.map((c) => ({ code: c, famille: dtcFamily(c) })), brut: r });
      }),
    ),
    sdkTool(
      "obd_mesures",
      `Mesures en direct par l'OBD : ${Object.entries(PIDS).map(([k, v]) => `${k} ${v.nom}`).join(", ")}.`,
      { pids: z.array(z.string()).optional(), port: z.string().optional() },
      safe(async ({ pids, port }) => {
        const wanted = (pids?.length ? pids : ["010C", "0105", "010D", "0104", "0111", "0142", "012F"]).map((p) => p.toUpperCase()).filter((p) => PIDS[p]);
        const r = await h.obd([...ELM_INIT, ...wanted], port);
        return text(wanted.map((p) => parsePid(p, r[p] ?? "") ?? { pid: p, valeur: null, note: "non pris en charge par la voiture" }));
      }),
    ),
    sdkTool(
      "obd_effacer_codes",
      "Efface les codes défaut et éteint le témoin moteur (mode 04). Seulement si Alex l'a demandé explicitement après avoir noté les codes : confirmation doit être vrai.",
      { confirmation: z.boolean(), port: z.string().optional() },
      safe(async ({ confirmation, port }) => {
        if (!confirmation) return failure("Il faut l'accord explicite d'Alex pour effacer les codes.");
        const r = await h.obd([...ELM_INIT, "04"], port);
        return text(/44/.test(r["04"] ?? "") ? "Codes effacés." : `Réponse : ${r["04"] ?? "aucune"}`);
      }),
    ),
    sdkTool("obd_detecter", "Cherche l'adaptateur ELM327 sur les ports série (Bluetooth classique ou USB).", {}, safe(async () => text((await h.findObd()) ?? "Aucun adaptateur ELM327 trouvé : branche-le, mets le contact, et appaire-le en Bluetooth dans Windows (code 1234 ou 0000).")), RO),

    // ---------- Procédures apprises ----------
    sdkTool("procedures_lister", "Procédures qu'Alex t'a montrées ou dictées, que tu sais refaire.", {}, safe(async () => text(h.procedures.list())), RO),
    sdkTool("procedure_lire", "Lit une procédure.", { nom: z.string() }, safe(async ({ nom }) => text(h.procedures.read(nom) ?? "Procédure inconnue.")), RO),
    sdkTool("procedure_enregistrer", "Écrit ou corrige une procédure (Markdown : objectif, avant de commencer, étapes, paramètres, vérification, pièges), par exemple quand Alex te l'explique de vive voix.", { nom: z.string(), markdown: z.string() }, safe(async ({ nom, markdown }) => text(`Enregistrée : ${h.procedures.write(nom, markdown)}`))),
    sdkTool("procedure_executer", "Refait une procédure apprise, en tâche de fond, avec les paramètres du jour (date, fichier…).", { nom: z.string(), parametres: z.string().optional() }, safe(async ({ nom, parametres }) => text(`Lancée (${h.runProcedure(nom, parametres)}).`))),

    // ---------- IA locale ----------
    sdkTool("ia_locale_modeles", "Modèles d'IA installés sur le PC (Ollama).", {}, safe(async () => text(await h.localAI.models())), RO),
    sdkTool("ia_locale_demander", "Fait traiter un texte par un modèle local (rien ne quitte le PC) : données privées, essai d'un modèle, comparaison.", { invite: z.string(), modele: z.string().optional(), systeme: z.string().optional() }, safe(async ({ invite, modele, systeme }) => {
      const r = await h.localAI.chat([...(systeme ? [{ role: "system" as const, content: systeme }] : []), { role: "user", content: invite }], modele ? { model: modele } : {});
      return text({ modele: r.model, reponse: r.text, ...(r.stats ? { stats: r.stats } : {}) });
    })),
    sdkTool("ia_locale_banc", "Banc d'essai de modèles locaux (vitesse en jetons/s, premier jeton, réponses) sur des invites standard ou les tiennes, rapport dans Documents\\Jarvis\\ia\\bancs.", { modeles: z.array(z.string()).min(1).max(8), invites: z.array(z.string()).max(10).optional() }, safe(async ({ modeles, invites }) => {
      const r = await h.localAI.bench(modeles, invites, path.join(h.workspace, "ia", "bancs"));
      return text({ fichier: r.fichier, resume: r.resultats.map((x) => ({ modele: x.modele, invite: x.invite.slice(0, 50), jetonsParSeconde: x.jetonsParSeconde, premierJetonMs: x.premierJetonMs })) });
    })),

    // ---------- Électronique ----------
    sdkTool("micro_cartes", "Cartes Arduino/ESP32 branchées (port, modèle, FQBN).", {}, safe(async () => text(await h.micro.boards())), RO),
    sdkTool("micro_compiler", "Compile un croquis (dossier contenant le .ino) pour une carte (FQBN, ex. arduino:avr:uno, esp32:esp32:esp32). Avec port, téléverse aussi.", { dossier: z.string(), fqbn: z.string(), port: z.string().optional() }, safe(async ({ dossier, fqbn, port }) => {
      const dir = path.resolve(h.workspace, dossier);
      return text(port ? await h.micro.upload(dir, fqbn, port) : await h.micro.compile(dir, fqbn));
    })),
    sdkTool("micro_installer", "Installe un cœur de carte (ex. esp32:esp32) ou une bibliothèque Arduino.", { coeur: z.string().optional(), bibliotheque: z.string().optional() }, safe(async ({ coeur, bibliotheque }) => text([coeur ? await h.micro.installCore(coeur) : "", bibliotheque ? await h.micro.installLibrary(bibliotheque) : ""].filter(Boolean).join("\n") || "Indique un cœur ou une bibliothèque."))),
    sdkTool("micro_moniteur", "Moniteur série : lit ce qu'envoie la carte pendant quelques secondes (et envoie une ligne si besoin).", { port: z.string(), baud: z.number().int().optional(), secondes: z.number().int().min(1).max(120).optional(), envoyer: z.string().optional() }, safe(async ({ port, baud, secondes, envoyer }) => text((await h.serialMonitor(port, baud ?? 115200, secondes ?? 5, envoyer)) || "(rien reçu)"))),

    // ---------- Papiers et budget ----------
    sdkTool("papiers_chercher", "Cherche dans les papiers classés (factures, contrats, avis…) : émetteur, montant, échéance, fichier.", { recherche: z.string() }, safe(async ({ recherche }) => text(h.papers.search(recherche).slice(-30))), RO),
    sdkTool("papiers_echeances", "Échéances à venir (factures à payer, réponses à envoyer).", { jours: z.number().int().min(1).max(365).optional() }, safe(async ({ jours }) => text(h.papers.upcoming(jours ?? 60))), RO),
    sdkTool("papier_classer", "Classe un document précis (chemin), ou tout ce qui attend dans papiers\\a-classer si aucun chemin.", { chemin: z.string().optional() }, safe(async ({ chemin }) => text(chemin ? await h.papers.file(path.resolve(h.workspace, chemin)) : await h.papers.sweep()))),
    sdkTool("budget_importer", "Importe un relevé de compte exporté de la banque (CSV) ; les doublons sont ignorés.", { chemin: z.string(), compte: z.string().optional() }, safe(async ({ chemin, compte }) => text(await h.budget.importFile(path.resolve(h.workspace, chemin), compte)))),
    sdkTool("budget_bilan", "Bilan d'un mois (AAAA-MM) : entrées, sorties, solde, dépenses par catégorie comparées à la moyenne des 3 mois précédents, plus grosses dépenses, opérations à classer.", { mois: z.string().regex(/^\d{4}-\d{2}$/) }, safe(async ({ mois }) => text(h.budget.summary(mois))), RO),
    sdkTool("budget_operations", "Opérations filtrées par mois, catégorie ou texte du libellé.", { mois: z.string().optional(), categorie: z.string().optional(), recherche: z.string().optional() }, safe(async (f) => text(h.budget.operations(f).slice(-200))), RO),
    sdkTool("budget_regle", "Règle de classement (motif du libellé, expression régulière possible → catégorie), appliquée aussi aux opérations déjà importées.", { motif: z.string(), categorie: z.string() }, safe(async ({ motif, categorie }) => text(`${h.budget.addRule(motif, categorie)} opération(s) reclassée(s).`))),

    // ---------- Travail (pseudonymes) ----------
    sdkTool("travail_fichier_lire", "Lit un document de travail (Excel, CSV, Word, PDF, texte) du dossier Travail : les noms des conseillers y sont remplacés par « Conseiller A », « Conseiller B »… Garde ces alias dans tes réponses : Jarvis remet les vrais noms à l'affichage.", { chemin: z.string(), feuille: z.string().optional() }, safe(async ({ chemin, feuille }) => text(await h.readWorkFile(chemin, feuille))), RO),
    sdkTool("travail_demasquer", "Remet les vrais noms à la place des alias « Conseiller A »… dans un fichier que tu as produit (Markdown, CSV, texte, Excel), sur le PC.", { chemin: z.string() }, safe(async ({ chemin }) => text(await h.unmaskFile(chemin)))),

    // ---------- Traçabilité et sauvegardes ----------
    sdkTool("actions_journal", "Ce que tu as fait (outils utilisés, commandes, fichiers) un jour donné (AAAA-MM-JJ, aujourd'hui par défaut), y compris ce qui a été bloqué.", { jour: z.string().optional() }, safe(async ({ jour }) => text(h.actions.day(jour).slice(-300))), RO),
    sdkTool("fichier_corbeille", "Met des fichiers ou dossiers à la corbeille de Windows (récupérables). C'est la seule façon de supprimer.", { chemins: z.array(z.string()).min(1).max(200) }, safe(async ({ chemins }) => text(await h.recycle(chemins.map((c) => path.resolve(h.workspace, c)))))),
    sdkTool("fichier_versions", "Copies d'un fichier faites avant tes modifications, pour revenir en arrière.", { chemin: z.string() }, safe(async ({ chemin }) => text(h.versions.list(path.resolve(h.workspace, chemin)))), RO),
    sdkTool("fichier_restaurer", "Remet une version d'un fichier (l'état actuel est gardé en copie).", { version: z.string(), chemin: z.string() }, safe(async ({ version, chemin }) => (h.versions.restore(version, path.resolve(h.workspace, chemin)), text("Restauré.")))),
    sdkTool("sauvegardes", "Sauvegardes (archives quotidiennes de la mémoire, des projets et des documents) ; maintenant=true pour en faire une tout de suite.", { maintenant: z.boolean().optional() }, safe(async ({ maintenant }) => text(maintenant ? await h.backups.run() : { derniere: h.backups.last, archives: h.listBackups() }))),
    sdkTool("sauvegarde_restaurer", "Extrait un fichier d'une archive de sauvegarde (chemin dans l'archive, par ex. projets/volant/JOURNAL.md) vers un dossier.", { archive: z.string(), fichier: z.string(), destination: z.string() }, safe(async ({ archive, fichier, destination }) => text(await h.restoreFromBackup(archive, fichier, path.resolve(h.workspace, destination))))),
    sdkTool("diagnostic", "Bilan de santé de Jarvis : cerveau, oreilles, voix, empreinte vocale, caméras, maison, Spotify, planning, réveil, sauvegardes, coffre-fort, IA locale, labo… avec ce qu'il faut corriger.", {}, safe(async () => text(await h.diagnostic())), RO),
    sdkTool("afficher_fichier_image", "Affiche une image du disque (figure du labo, photo, schéma) sur une page.", { chemin: z.string(), titre: z.string(), page: z.enum(PAGE_IDS).optional() }, safe(async ({ chemin, titre, page }) => (await h.showImage(titre, path.resolve(h.workspace, chemin), page), text("Affiché.")))),
  ];
}

export function plusMcpServer(host: PlusHost) {
  return createSdkMcpServer({ name: "jarvis_plus", version: "1.0.0", tools: plusTools(host) });
}
