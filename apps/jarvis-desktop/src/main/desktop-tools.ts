import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createSdkMcpServer, tool as sdkTool } from "@anthropic-ai/claude-agent-sdk";
import { connectorTools } from "@muscu/jarvis/src/mcp.js";
import { runTool, type ToolContext } from "@muscu/jarvis/src/tools.js";
import { z } from "zod/v4";
import type { Journal } from "./journal.js";
import { PAGES, type PageId } from "./pages/catalog.js";
import type { PerfMonitor } from "./perf.js";
import type { ProjectView } from "./project-view.js";
import type { SecurityService } from "./security.js";
import type { WeatherService } from "./weather.js";
import type { RaceManager } from "./racing/manager.js";
import { focusWindowScript, hotkeyScript, LIST_WINDOWS_SCRIPT, mouseScript, openScript, runPowerShell, typeScript, type MouseAction } from "./pc.js";

/** Ce que l'interface fournit aux outils (captures, affichage, notifications). */
export interface DesktopHost {
  /** Captures des écrans, avec ce qu'il faut pour convertir un point de l'image en pixel réel. */
  captureScreens: () => Promise<ScreenShot[]>;
  /** Images des caméras (toutes, ou une seule). */
  captureCameras: (index?: number) => Promise<Array<{ nom: string; jpegBase64: string }>>;
  /** Panneau d'affichage (texte, image, modèle 3D), sur l'accueil ou sur une page. */
  show: (panel: { titre: string; markdown?: string; imageDataUrl?: string; modelPath?: string; page?: PageId }) => void;
  notify: (title: string, body: string) => void;
  workspace: string;
  pages?: {
    open: (page: PageId, ecran?: "gauche" | "centre" | "droite" | "principal") => void;
    /** Plusieurs pages ensemble (côte à côte sur un écran, une par écran sinon). */
    openMany?: (pages: PageId[]) => void;
    close: (page: PageId | "toutes") => void;
    layout: () => unknown;
  };
  /** Change le mode de surveillance (simple, complète, arrêtée). */
  setSurveillance?: (mode: "off" | "simple" | "complete") => void;
  views?: { code: ProjectView; rd: ProjectView };
  security?: SecurityService;
  perf?: PerfMonitor;
  weather?: WeatherService;
}

const PAGE_IDS = PAGES.map((p) => p.id) as [PageId, ...PageId[]];

export interface ScreenShot {
  nom: string;
  jpegBase64: string;
  /** Largeur et hauteur de l'image envoyée. */
  width: number;
  height: number;
  /** Origine et échelle en pixels physiques : réel = origine + point × échelle. */
  originX: number;
  originY: number;
  scale: number;
}

type ToolResult = { content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>; isError?: boolean };

const text = (value: unknown): ToolResult => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] });
const failure = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/** Dernières captures, pour traduire un clic « sur l'image » en position réelle à l'écran. */
export class ScreenMap {
  private shots: ScreenShot[] = [];

  remember(shots: ScreenShot[]): void {
    this.shots = shots;
  }

  toPhysical(x: number, y: number, screen = 0): { x: number; y: number } {
    const shot = this.shots[screen];
    if (!shot) throw new Error("Fais d'abord une capture d'écran (ecran_capture) pour savoir où cliquer.");
    if (x < 0 || y < 0 || x > shot.width || y > shot.height) throw new Error(`Point hors de l'image (${shot.width}×${shot.height}).`);
    return { x: shot.originX + x * shot.scale, y: shot.originY + y * shot.scale };
  }
}

async function ps(script: string, timeoutMs?: number, cwd?: string): Promise<ToolResult> {
  const result = await runPowerShell(script, timeoutMs, cwd);
  const output = [result.stdout, result.stderr && `Erreurs :\n${result.stderr}`, result.timedOut && "(arrêté : délai dépassé)"].filter(Boolean).join("\n");
  return { content: [{ type: "text", text: output || `Terminé (code ${result.code}).` }], ...(result.code !== 0 ? { isError: true } : {}) };
}

function raceTools(race: RaceManager) {
  return [
    sdkTool(
      "course_etat",
      "État en direct de la séance de simulation en cours (F1 ou Le Mans Ultimate) : tour, position, écarts, temps, carburant, énergie, pneus (usure, températures), dégâts, drapeaux, météo, et la liste des tours. Vide si Alex ne roule pas.",
      {},
      async () => text(race.state ? { ...race.state, enDirect: race.active } : { enDirect: false, message: "Aucune séance de simulation en cours." }),
      { annotations: { readOnlyHint: true } },
    ),
    sdkTool(
      "lmu_api",
      "Lit une adresse de l'API locale de Le Mans Ultimate (jeu lancé), par exemple /rest/watch/standings, /rest/watch/sessionInfo, /rest/garage/getVehicleCondition, /rest/garage/UIScreen/RepairAndRefuel, /rest/strategy/usage ou /rest/sessions/weather. Lecture seule. Utile pour une question précise que course_etat ne couvre pas.",
      { chemin: z.string().describe("Chemin commençant par /rest/") },
      async ({ chemin }) => {
        try {
          const data = JSON.stringify(await race.lmuApi.get(chemin));
          return text(data.length > 30_000 ? `${data.slice(0, 30_000)}… [tronqué]` : data);
        } catch (error) {
          return failure(error instanceof Error ? error.message : String(error));
        }
      },
      { annotations: { readOnlyHint: true } },
    ),
  ];
}

export function desktopTools(host: DesktopHost, screens = new ScreenMap(), journal?: Journal, race?: RaceManager) {
  const journalTools = journal
    ? [
        sdkTool(
          "journal_chercher",
          "Cherche dans le journal de tous les échanges passés avec Alex (demandes, réponses, outils utilisés). Pour retrouver ce qui a été fait, dit ou décidé : « le réglage de Spa », « le planning de la semaine dernière »… Sans recherche : les échanges les plus récents.",
          { recherche: z.string().optional(), jours: z.number().int().min(1).max(3650).optional() },
          async ({ recherche, jours }) => text(journal.search(recherche, jours ?? 90)),
          { annotations: { readOnlyHint: true } },
        ),
      ]
    : [];
  return [
    ...journalTools,
    ...(race ? raceTools(race) : []),
    sdkTool(
      "ecran_capture",
      "Capture d'écran de l'ordinateur d'Alex (tous les écrans, ou un seul). Indispensable avant de cliquer : les coordonnées de pc_souris se lisent sur cette image.",
      { ecran: z.number().int().min(0).optional().describe("Numéro d'écran (0 = principal). Par défaut : tous.") },
      async ({ ecran }) => {
        const shots = await host.captureScreens();
        screens.remember(shots);
        const chosen = ecran === undefined ? shots : shots.filter((_, i) => i === ecran);
        if (chosen.length === 0) return failure("Écran introuvable.");
        return {
          content: chosen.flatMap((s, i) => [
            { type: "text" as const, text: `Écran ${ecran ?? i} « ${s.nom} » (${s.width}×${s.height})` },
            { type: "image" as const, data: s.jpegBase64, mimeType: "image/jpeg" },
          ]),
        };
      },
      { annotations: { readOnlyHint: true } },
    ),
    sdkTool(
      "camera_capture",
      "Regarde par les caméras (webcams) : Alex, ses gestes, ce qu'il te montre, la pièce. Sans numéro, renvoie une image de chaque caméra (vue à plusieurs angles).",
      { camera: z.number().int().min(0).optional() },
      async ({ camera }) => {
        const frames = await host.captureCameras(camera);
        if (frames.length === 0) return failure("Aucune caméra active. Alex peut les activer dans le panneau Caméras.");
        return {
          content: frames.flatMap((f, i) => [
            { type: "text" as const, text: `Caméra ${camera ?? i} « ${f.nom} »` },
            { type: "image" as const, data: f.jpegBase64, mimeType: "image/jpeg" },
          ]),
        };
      },
      { annotations: { readOnlyHint: true } },
    ),
    sdkTool(
      "pc_powershell",
      "Exécute un script PowerShell sur le PC d'Alex (Windows) et renvoie la sortie : fichiers, réglages, installation de logiciels avec winget, informations système, automatisation. Répertoire de travail : le dossier Jarvis.",
      { script: z.string(), delai_secondes: z.number().int().min(1).max(1800).optional() },
      async ({ script, delai_secondes }) => ps(script, (delai_secondes ?? 120) * 1000, host.workspace),
    ),
    sdkTool(
      "pc_ouvrir",
      "Ouvre une application (nom ou chemin, ex. « excel », « notepad », « C:\\\\Jeux\\\\sim.exe »), un fichier, un dossier ou une adresse web dans le navigateur par défaut d'Alex.",
      { cible: z.string(), arguments: z.string().optional() },
      async ({ cible, arguments: args }) => ps(openScript(cible, args), 30_000),
    ),
    sdkTool(
      "pc_fenetres",
      "Liste les fenêtres ouvertes, ou met une fenêtre au premier plan (par un morceau de son titre ou de son nom de programme).",
      { action: z.enum(["lister", "activer"]), nom: z.string().optional() },
      async ({ action, nom }) => {
        if (action === "lister") return ps(LIST_WINDOWS_SCRIPT, 20_000);
        if (!nom) return failure("Indique le nom de la fenêtre à activer.");
        return ps(focusWindowScript(nom), 20_000);
      },
    ),
    sdkTool(
      "pc_souris",
      "Déplace la souris, clique, double-clique, fait un clic droit, fait défiler ou glisse. Les coordonnées sont celles de la dernière capture d'écran (ecran_capture). Vérifie le résultat par une nouvelle capture.",
      {
        action: z.enum(["deplacer", "clic", "double_clic", "clic_droit", "molette_haut", "molette_bas", "glisser"]),
        x: z.number(),
        y: z.number(),
        vers_x: z.number().optional(),
        vers_y: z.number().optional(),
        ecran: z.number().int().min(0).optional(),
      },
      async ({ action, x, y, vers_x, vers_y, ecran }) => {
        try {
          const from = screens.toPhysical(x, y, ecran ?? 0);
          const to = vers_x !== undefined && vers_y !== undefined ? screens.toPhysical(vers_x, vers_y, ecran ?? 0) : undefined;
          return await ps(mouseScript(action as MouseAction, from.x, from.y, to?.x, to?.y), 15_000);
        } catch (error) {
          return failure(error instanceof Error ? error.message : String(error));
        }
      },
    ),
    sdkTool(
      "pc_clavier",
      "Tape du texte dans la fenêtre active (accents compris), ou envoie un raccourci clavier (« ctrl+s », « alt+tab », « win+d », « enter », « volume_haut », « muet », « lecture », « piste_suivante »).",
      { texte: z.string().optional(), raccourci: z.string().optional() },
      async ({ texte, raccourci }) => {
        try {
          if (raccourci) return await ps(hotkeyScript(raccourci), 15_000);
          if (texte !== undefined) return await ps(typeScript(texte), 15_000);
          return failure("Donne un texte ou un raccourci.");
        } catch (error) {
          return failure(error instanceof Error ? error.message : String(error));
        }
      },
    ),
    sdkTool(
      "afficher",
      "Affiche un panneau : texte en Markdown (tableau, résumé, code, étapes) et/ou une image du disque (graphique, schéma, photo). Par défaut sur l'accueil ; avec page, sur la page Travail (plannings, indicateurs d'équipe), R&D (résultats d'essais, calculs), Code ou Ingénieur (analyse de course), qui s'ouvre si besoin.",
      { titre: z.string(), markdown: z.string().optional(), image_chemin: z.string().optional(), page: z.enum(PAGE_IDS).optional() },
      async ({ titre, markdown, image_chemin, page }) => {
        let imageDataUrl: string | undefined;
        if (image_chemin) {
          const file = path.resolve(host.workspace, image_chemin);
          const ext = path.extname(file).toLowerCase().replace(".", "") || "png";
          imageDataUrl = `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${(await readFile(file)).toString("base64")}`;
        }
        host.show({ titre, ...(markdown ? { markdown } : {}), ...(imageDataUrl ? { imageDataUrl } : {}), ...(page ? { page } : {}) });
        return text("Affiché.");
      },
    ),
    sdkTool(
      "afficher_modele_3d",
      "Affiche un modèle 3D (fichier STL) en grand dans l'interface, qu'Alex peut tourner et zoomer à la souris ou d'un geste de la main.",
      { chemin: z.string(), titre: z.string().optional(), page: z.enum(PAGE_IDS).optional() },
      async ({ chemin, titre, page }) => {
        const file = path.resolve(host.workspace, chemin);
        const info = await stat(file).catch(() => undefined);
        if (!info?.isFile()) return failure(`Fichier introuvable : ${file}`);
        if (!/\.stl$/i.test(file)) return failure("Seuls les fichiers STL sont affichables (exporte d'abord en STL).");
        host.show({ titre: titre ?? path.basename(file), modelPath: file, ...(page ? { page } : {}) });
        return text("Modèle affiché.");
      },
    ),
    sdkTool(
      "notifier",
      "Affiche une notification Windows (utile pour une info à garder sous les yeux, une alerte ou la fin d'une longue tâche).",
      { titre: z.string(), message: z.string() },
      async ({ titre, message }) => {
        host.notify(titre, message);
        return text("Notification envoyée.");
      },
    ),
    ...pageTools(host),
  ];
}

const SCREEN = z.enum(["gauche", "centre", "droite", "principal"]);

function pageTools(host: DesktopHost) {
  const tools = [];
  if (host.pages) {
    const pages = host.pages;
    tools.push(
      sdkTool(
        "page_ouvrir",
        "Ouvre une page de Jarvis sur son écran (ou celui indiqué) : ingenieur (course), travail, code, rd (recherche et développement), securite (caméras), performances (PC), diagnostic, accueil. Avec « avec », ouvre plusieurs pages ensemble (côte à côte avec un seul écran). Ne l'ouvre que si Alex le demande ou si c'est nécessaire pour lui montrer un résultat demandé.",
        { page: z.enum(PAGE_IDS), ecran: SCREEN.optional(), avec: z.array(z.enum(PAGE_IDS)).max(2).optional() },
        async ({ page, ecran, avec }) => {
          if (avec?.length && pages.openMany) pages.openMany([page, ...avec]);
          else pages.open(page, ecran);
          return text(`Page ${[page, ...(avec ?? [])].join(" et ")} ouverte.`);
        },
      ),
      sdkTool(
        "page_fermer",
        "Ferme une page (ou « toutes ») ; l'accueil reste.",
        { page: z.union([z.enum(PAGE_IDS), z.literal("toutes")]) },
        async ({ page }) => {
          pages.close(page);
          return text("Fermée.");
        },
      ),
      sdkTool("pages_disposition", "Quelles pages sont ouvertes, et sur quel écran chacune s'affiche.", {}, async () => text(pages.layout()), { annotations: { readOnlyHint: true } }),
    );
  }
  if (host.views) {
    const views = host.views;
    tools.push(
      sdkTool(
        "code_montrer",
        "Affiche un projet sur la page Code : l'arborescence, le fichier indiqué et l'aperçu en direct du résultat (page HTML, image, STL, PDF du projet, ou une adresse http://localhost d'un serveur de développement que tu as lancé). L'aperçu se rafraîchit à chaque modification. Ouvre la page Code.",
        { dossier: z.string().describe("Dossier du projet (absolu ou relatif au dossier Jarvis)"), fichier: z.string().optional(), apercu: z.string().optional() },
        async ({ dossier, fichier, apercu }) => {
          try {
            const snap = views.code.show(path.resolve(host.workspace, dossier), { ...(fichier ? { fichier } : {}), ...(apercu ? { apercu } : {}) });
            host.pages?.open("code");
            return text(`Projet ${snap.nom} affiché (${snap.fichiers.length} fichiers).`);
          } catch (error) {
            return failure(error instanceof Error ? error.message : String(error));
          }
        },
      ),
      sdkTool(
        "rd_montrer",
        "Affiche un projet sur la page R&D : son JOURNAL.md, ses modèles 3D et ses images (graphiques, photos d'essais), mis à jour en direct. Ouvre la page R&D.",
        { dossier: z.string() },
        async ({ dossier }) => {
          try {
            const snap = views.rd.show(path.resolve(host.workspace, dossier));
            host.pages?.open("rd");
            return text(`Projet ${snap.nom} affiché sur la page R&D.`);
          } catch (error) {
            return failure(error instanceof Error ? error.message : String(error));
          }
        },
      ),
    );
  }
  if (host.security?.enabled) {
    const security = host.security;
    tools.push(
      sdkTool(
        "securite_cameras",
        "Image actuelle des caméras de surveillance Tapo (toutes, ou une par son nom). Pour vérifier ce qui se passe chez Alex.",
        { camera: z.string().optional() },
        async ({ camera }) => {
          const names = security.cameraNames();
          const chosen = names.map((nom, i) => ({ nom, i })).filter((c) => !camera || c.nom.toLowerCase().includes(camera.toLowerCase()));
          const content = chosen.flatMap((c) => {
            const frame = security.latestFrame(c.i);
            return frame ? [{ type: "text" as const, text: `Caméra « ${c.nom} »` }, { type: "image" as const, data: frame.toString("base64"), mimeType: "image/jpeg" }] : [{ type: "text" as const, text: `Caméra « ${c.nom} » : pas d'image (hors ligne ?)` }];
          });
          return content.length ? { content } : failure(`Caméras : ${names.join(", ") || "aucune"}.`);
        },
        { annotations: { readOnlyHint: true } },
      ),
      sdkTool(
        "securite_evenements",
        "Derniers mouvements détectés par les caméras (heure, caméra, image enregistrée), et l'état de la surveillance (armée ou non).",
        { nombre: z.number().int().min(1).max(100).optional() },
        async ({ nombre }) => text({ surveillance: security.mode, evenements: security.events.slice(0, nombre ?? 20) }),
        { annotations: { readOnlyHint: true } },
      ),
      sdkTool(
        "securite_surveillance",
        "Mode de surveillance : off (mouvements seulement enregistrés), simple (chaque mouvement annoncé et notifié), complete (en plus : vidéo, vérification qu'il s'agit d'une personne, alerte photo sur le téléphone, page Sécurité ouverte, lumières et message de dissuasion ; Jarvis devient rouge).",
        { mode: z.enum(["off", "simple", "complete"]) },
        async ({ mode }) => {
          if (host.setSurveillance) host.setSurveillance(mode);
          else security.mode = mode;
          return text({ off: "Surveillance désactivée.", simple: "Surveillance simple activée.", complete: "Surveillance complète activée." }[mode]);
        },
      ),
    );
  }
  if (host.perf) {
    const perf = host.perf;
    tools.push(
      sdkTool(
        "pc_performances",
        "Performances du PC maintenant : charge et température du processeur, mémoire, carte graphique (charge, mémoire, température), disques, réseau, programmes les plus gourmands et alertes.",
        {},
        async () => text((await perf.sample()) ?? "Mesure indisponible."),
        { annotations: { readOnlyHint: true } },
      ),
    );
  }
  if (host.weather) {
    const weather = host.weather;
    tools.push(
      sdkTool(
        "meteo",
        "Météo locale d'Alex (ville réglée) : maintenant, prochaines heures, aujourd'hui et demain.",
        {},
        async () => text((await weather.refresh()) ?? "Météo indisponible : règle JARVIS_VILLE."),
        { annotations: { readOnlyHint: true } },
      ),
    );
  }
  return tools;
}

/** Outils existants de Jarvis (maison, mails, agenda, notes, mémoire, navigateur, calculs). */
export function sharedTools(ctx: ToolContext) {
  const definitions = connectorTools(ctx).filter((d) => {
    if (!ctx.mail && d.name.startsWith("mail")) return false;
    if (!ctx.agenda && d.name.startsWith("agenda")) return false;
    if (!ctx.browser && d.name.startsWith("navigateur")) return false;
    if (!ctx.home && d.name.startsWith("maison")) return false;
    if (!ctx.tapo && d.name.startsWith("tapo")) return false;
    return true;
  });
  return definitions.map((definition) => {
    const shape = (definition.schema as unknown as { shape: Record<string, z.ZodType> }).shape;
    return sdkTool(definition.name, definition.description, shape, async (input: unknown): Promise<ToolResult> => {
      const result = await runTool(definition.name, input ?? {}, ctx, [], connectorTools(ctx));
      if (result.image) {
        return {
          content: [
            { type: "image", data: result.image.data, mimeType: result.image.mediaType },
            { type: "text", text: result.content },
          ],
        };
      }
      return { content: [{ type: "text", text: result.content }], ...(result.isError ? { isError: true } : {}) };
    });
  });
}

export function jarvisMcpServer(host: DesktopHost, ctx: ToolContext, screens?: ScreenMap, journal?: Journal, race?: RaceManager) {
  return createSdkMcpServer({
    name: "jarvis",
    version: "0.4.0",
    alwaysLoad: true,
    tools: [...desktopTools(host, screens, journal, race), ...sharedTools(ctx)],
  });
}
