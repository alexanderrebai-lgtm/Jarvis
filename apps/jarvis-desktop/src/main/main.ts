import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import path from "node:path";
import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, Notification, powerSaveBlocker, protocol, safeStorage, screen, shell, Tray } from "electron";
import ffmpegPath from "ffmpeg-static";
import { WebBrowser } from "@muscu/jarvis/src/browser.js";
import { readConfig } from "@muscu/jarvis/src/config.js";
import { AgendaService } from "@muscu/jarvis/src/google/agenda.js";
import { createGoogleClients } from "@muscu/jarvis/src/google/client.js";
import { MailService } from "@muscu/jarvis/src/google/mail.js";
import { HomeAssistant } from "@muscu/jarvis/src/home.js";
import { Inbox } from "@muscu/jarvis/src/inbox.js";
import { createMcpServer } from "@muscu/jarvis/src/mcp.js";
import { NotesRepository } from "@muscu/jarvis/src/notes.js";
import { PendingActions } from "@muscu/jarvis/src/pending.js";
import { createWebhookServer } from "@muscu/jarvis/src/server.js";
import { JsonStore } from "@muscu/jarvis/src/store.js";
import { parseDeviceList, realTapoDriver, TapoHome } from "@muscu/jarvis/src/tapo.js";
import type { ToolContext } from "@muscu/jarvis/src/tools.js";
import { parseIntent, sayDuration, type Intent } from "../shared/intents.js";
import { ConversationWindow, detectWake, wakeVariants } from "../shared/wake.js";
import { ActionLog, FileVersions, summarizeInput } from "./actions.js";
import { BackupService } from "./backup.js";
import { Brain, type BrainReply } from "./brain.js";
import { Budget } from "./budget.js";
import { jarvisMcpServer, ScreenMap, type DesktopHost, type ScreenShot } from "./desktop-tools.js";
import { runChecks, sayDiagnostic } from "./diagnostic.js";
import { Microcontrollers } from "./electronics.js";
import { DEFAULT_GAME_PROCESSES, GameWatcher } from "./games.js";
import { Garage } from "./garage.js";
import { Journal } from "./journal.js";
import { Lab } from "./lab.js";
import { Learning, mentorInstruction } from "./learning.js";
import { e5Embedder, Library } from "./library/index.js";
import { LocalAI, localPersona } from "./local-ai.js";
import { LocalVoice } from "./local-voice.js";
import { fallbackMorning, morningPrompt, type MorningContext } from "./morning.js";
import { pageInfo, parsePageCommand, PAGES, type PageId } from "./pages/catalog.js";
import { DispositionStore, parseDispositionCommand } from "./pages/dispositions.js";
import { PageManager } from "./pages/manager.js";
import { extractionPrompt, Papers, parseExtraction } from "./papers.js";
import { PerfMonitor } from "./perf.js";
import { personaPrompt } from "./persona.js";
import { PhoneAlerts } from "./phone.js";
import { plusMcpServer, type PlusHost } from "./plus-tools.js";
import { runPowerShell } from "./pc.js";
import { Pseudonymizer } from "./privacy.js";
import { Procedures } from "./procedures.js";
import { insideProject, ProjectView } from "./project-view.js";
import { Proactive } from "./proactive.js";
import type { Verbosity } from "./racing/engineer.js";
import { RaceManager } from "./racing/manager.js";
import { deepResearchPrompt, Literature } from "./research/literature.js";
import { wakeTaskScript, WakeUp } from "./reveil/alarm.js";
import { parseCodes, PlanningReader, type Shift } from "./reveil/planning.js";
import { DEFAULT_RULES, parseDays } from "./reveil/schedule.js";
import { SpotifyClient, toSpotifyUri, WAKE_TRACKS, type SpotifyTokens } from "./reveil/spotify.js";
import { Routines, Timers } from "./routines.js";
import { parseCameras, SecurityService, type SurveillanceMode } from "./security.js";
import { elmScript, findElmScript } from "./serial.js";
import { BackgroundTasks } from "./tasks.js";
import { SettingsStore } from "./settings.js";
import { sealSecrets } from "./secret-backup.js";
import { describeLost, Watchdog } from "./watchdog.js";
import { connectPlusHost } from "./plus-host.js";
import { createRoutineRunner } from "./routine-runner.js";
import { createIntentActions } from "./intent-actions.js";
import { Updates } from "./updates.js";
import { MusicPanel } from "./music-panel.js";
import { createPcCare } from "./pc-care.js";
import { createSettingActions } from "./settings-actions.js";
import { createDiagnostics } from "./diagnostic-checks.js";
import { buildProfile, tune } from "./hardware.js";
import { resilientFetch } from "./net-fetch.js";
import { dpapiCipher, isLegacyVault, migrateEnvSecrets, migrateLegacyVault, Vault } from "./vault.js";
import { Veille } from "./veille.js";
import { Ears, isInterruption, pickSpeechModel, SentenceSplitter, Voice, DEFAULT_VOICE } from "./voice.js";
import { ENROLL_PHRASES, VoiceLock, wavlmEmbedder } from "./voiceprint.js";
import { WeatherService } from "./weather.js";

// ---------- Fichiers et réglages ----------

// Une erreur au démarrage ne doit pas laisser Jarvis bloqué en silence : on l'affiche et on la journalise.
function reportCrash(error: unknown): void {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  try {
    appendFileSync(path.join(app.getPath("userData"), "erreurs.log"), `[${new Date().toISOString()}] ${text}\n`);
  } catch {
    // rien à faire de plus
  }
  console.error(text);
  if (startupTest) {
    console.error("[test] ÉCHEC : erreur au démarrage");
    app.exit(1);
    return;
  }
  if (app.isReady()) dialog.showErrorBox("Jarvis a rencontré un problème", text.slice(0, 1500));
}
/** Test de démarrage (GitHub, avant chaque publication) : Jarvis démarre, charge l'accueil, puis se ferme. */
const startupTest = process.env.JARVIS_TEST_DEMARRAGE === "1";
process.on("uncaughtException", reportCrash);
process.on("unhandledRejection", reportCrash);

if (!app.requestSingleInstanceLock()) app.quit();

// Protocole interne pour l'aperçu des projets (pages Code et R&D) : apercu://code/<fichier>.
protocol.registerSchemesAsPrivileged([{ scheme: "apercu", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const userDir = app.getPath("userData");
const envFile = path.join(userDir, "jarvis.env");
// Dans l'appli installée, les fichiers lus par d'autres programmes (Python…) sont hors de l'archive app.asar, dans app.asar.unpacked.
const assets = (() => {
  const inside = path.join(__dirname, "..", "assets");
  const unpacked = inside.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  return unpacked !== inside && existsSync(unpacked) ? unpacked : inside;
})();
mkdirSync(userDir, { recursive: true });
if (!existsSync(envFile)) copyFileSync(path.join(assets, "jarvis.env.example"), envFile);
process.loadEnvFile(envFile);
process.env.DATA_DIR ||= path.join(userDir, "data");

// Coffre-fort : les mots de passe tapés dans jarvis.env sont chiffrés par Windows (DPAPI), puis remis en mémoire.
// Sous Windows, le chiffrement direct est lisible dès le lancement ; ailleurs (développement), safeStorage.
const vault = new Vault(
  userDir,
  process.platform === "win32"
    ? dpapiCipher()
    : {
        available: () => {
          try {
            return safeStorage.isEncryptionAvailable();
          } catch {
            return false;
          }
        },
        encrypt: (text) => safeStorage.encryptString(text),
        decrypt: (data) => safeStorage.decryptString(data),
      },
);
let movedSecrets: string[] = [];
try {
  movedSecrets = migrateEnvSecrets(envFile, vault);
} catch (error) {
  console.warn("[coffre]", error);
}

const config = readConfig();
// Profil matériel : estimé tout de suite (cœurs, mémoire), précisé au démarrage avec les cartes graphiques.
let hardware = buildProfile({ cores: cpus().length }, totalmem(), []);
let tuning = tune(hardware);
const env = (name: string) => process.env[name]?.trim() || undefined;
const ownerName = env("OWNER_NAME") ?? "Alex";
const workspace = env("JARVIS_WORKSPACE") ?? path.join(app.getPath("documents"), "Jarvis");
const workFolder = env("TRAVAIL_DOSSIER") ?? path.join(workspace, "travail");
for (const dir of ["modeles", "projets", "travail", "bibliotheque", "recherches", "budget/releves", "papiers"]) mkdirSync(path.join(workspace, dir), { recursive: true });
const modelCache = path.join(userDir, "modeles-voix");

// ---------- Services partagés avec le serveur Jarvis ----------

const notes = new NotesRepository(config.dataDir);
const pending = new PendingActions(config.dataDir);
const inbox = new Inbox(config.dataDir);
const google = config.google ? createGoogleClients(config.google) : undefined;
const mail = google ? new MailService(google.gmail) : undefined;
const agenda = google ? new AgendaService(google.calendar, config.timeZone) : undefined;
const browser = config.browserEnabled ? new WebBrowser({ dataDir: config.dataDir, executablePath: config.chromiumPath }) : undefined;
const home = config.homeAssistant ? new HomeAssistant(config.homeAssistant.url, config.homeAssistant.token) : undefined;
// La liste des appareils est gardée : Jarvis ne se connecte au compte TP-Link qu'une fois par jour (sinon TP-Link verrouille le compte).
const tapoCache = path.join(config.dataDir, "tapo-appareils.json");
const tapo = config.tapo ? new TapoHome(realTapoDriver(config.tapo.email, config.tapo.password, parseDeviceList(config.tapo.devices)), { cacheFile: tapoCache, cacheKey: config.tapo.email.toLowerCase() }) : undefined;
const tools: ToolContext = { mail, agenda, notes, pending, inbox, browser, home, tapo };

// ---------- Pages et fenêtres ----------

let bubble: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
const flags = { micro: true, cameras: true, doNotDisturb: false, speaking: false, surveillance: "off" as SurveillanceMode, jeu: false };

function rendererUrl(page: string): string {
  return `file://${path.join(__dirname, "renderer", "index.html").replace(/\\/g, "/")}?page=${page}`;
}

const webPreferences = {
  preload: path.join(__dirname, "preload.cjs"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  backgroundThrottling: false,
  plugins: true,
};

const pages = new PageManager({
  dataDir: config.dataDir,
  url: rendererUrl,
  webPreferences,
  icon: path.join(assets, "icon.png"),
  quitting: () => quitting,
  onOpen: (page) => {
    if (page === "performances") {
      perf.detailed = true;
      void perf.sample();
    }
    void sendPageData(page);
  },
  onClose: (page) => {
    if (page === "performances") perf.detailed = false;
  },
});
const dispositions = new DispositionStore(config.dataDir);

function accueil(): BrowserWindow | undefined {
  return pages.window("accueil");
}

function showHome(): void {
  pages.openPage("accueil", undefined, { focus: true });
}

function createBubble(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    width: 380,
    height: 150,
    x: area.x + area.width - 400,
    y: area.y + area.height - 170,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    show: false,
    webPreferences,
  });
  win.setAlwaysOnTop(true, "floating");
  void win.loadURL(rendererUrl("bulle"));
  return win;
}

function toggleBubble(): void {
  if (!bubble) return;
  if (bubble.isVisible()) bubble.hide();
  else bubble.showInactive();
}

function broadcast(channel: string, payload: unknown): void {
  pages.broadcast(channel, payload);
  if (bubble && !bubble.isDestroyed()) bubble.webContents.send(channel, payload);
}

function setState(state: "veille" | "ecoute" | "reflexion" | "parole", detail?: string): void {
  broadcast("jarvis:state", { state, detail });
}

function updateTray(): void {
  if (!tray) return;
  tray.setToolTip(`J.A.R.V.I.S. — micro ${flags.micro ? "actif" : "coupé"}${flags.doNotDisturb ? ", ne pas déranger" : ""}${flags.surveillance === "complete" ? ", surveillance complète" : ""}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Accueil", click: showHome },
      { label: "Pages", submenu: PAGES.filter((p) => p.id !== "accueil").map((p) => ({ label: p.titre, click: () => pages.openPage(p.id) })) },
      { label: "Dispositions", submenu: dispositions.list().map((d) => ({ label: d.nom, click: () => applyDisposition(d.nom) })) },
      { label: "Fermer les pages", click: () => pages.closeAll() },
      { label: "Bulle flottante", type: "checkbox", checked: bubble?.isVisible() ?? false, click: () => (toggleBubble(), updateTray()) },
      { type: "separator" },
      { label: "Micro", type: "checkbox", checked: flags.micro, click: () => setFlag("micro", !flags.micro) },
      { label: "Caméras", type: "checkbox", checked: flags.cameras, click: () => setFlag("cameras", !flags.cameras) },
      { label: "Ne pas déranger", type: "checkbox", checked: flags.doNotDisturb, click: () => setFlag("doNotDisturb", !flags.doNotDisturb) },
      { label: "Mode jeu (libère la carte graphique)", type: "checkbox", checked: flags.jeu, click: () => (pcCare.setGameManual(!flags.jeu), updateGameMode()) },
      { label: "Surveillance", submenu: (["off", "simple", "complete"] as const).map((m) => ({ label: { off: "Arrêtée", simple: "Simple", complete: "Complète" }[m], type: "radio" as const, checked: flags.surveillance === m, click: () => setSurveillance(m) })) },
      { type: "separator" },
      { label: "Diagnostic", click: () => pages.openPage("diagnostic") },
      { label: "Nouvelle conversation", click: () => brain.reset() },
      { label: "Réglages", click: () => pages.openPage("reglages") },
      { label: "Chercher une mise à jour", click: () => void checkUpdates(true) },
      { label: "Réglages avancés (jarvis.env)", click: () => void shell.openPath(envFile) },
      { label: "Dossier de travail", click: () => void shell.openPath(workspace) },
      { label: "Lancer au démarrage de Windows", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (item) => setAutoStart(item.checked) },
      { type: "separator" },
      { label: "Quitter Jarvis", click: () => ((quitting = true), app.quit()) },
    ]),
  );
}

function setFlag(name: "micro" | "cameras" | "doNotDisturb", value: boolean): void {
  flags[name] = value;
  broadcast("jarvis:flags", flags);
  updateTray();
}

function setAutoStart(enabled: boolean): void {
  const args = app.isPackaged ? ["--hidden"] : [app.getAppPath(), "--hidden"];
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args });
  updateTray();
}

// ---------- Services des pages ----------

const weather = new WeatherService(env("JARVIS_VILLE"), (w) => broadcast("meteo:data", w));
const perf = new PerfMonitor((sample) => pages.broadcast("perf:data", sample));
const views = {
  code: new ProjectView((snap) => pages.broadcast("projet:data", { vue: "code", ...snap }, "code")),
  rd: new ProjectView((snap) => pages.broadcast("projet:data", { vue: "rd", ...snap }, "rd")),
};
// Les réglages sont relus à chaque envoi : un changement sur la page Réglages s'applique tout de suite.
const phone = new PhoneAlerts({
  get token() {
    return env("TELEGRAM_BOT_TOKEN");
  },
  get chatId() {
    return env("TELEGRAM_CHAT_ID");
  },
});
const security = new SecurityService({
  cameras: parseCameras(process.env.TAPO_CAMERAS),
  user: env("TAPO_CAMERA_COMPTE") ?? "",
  password: env("TAPO_CAMERA_MOT_DE_PASSE") ?? "",
  ffmpegPath: (ffmpegPath as unknown as string | null) ?? undefined,
  folder: path.join(workspace, "securite"),
  onEvent: (event, mode) => void onMotion(event, mode),
});

/** Surveillance : simple = annonce ; complète = vérification de personne, vidéo, alerte téléphone, dissuasion. */
async function onMotion(event: (typeof security.events)[number], mode: SurveillanceMode): Promise<void> {
  pages.broadcast("securite:evenement", event);
  if (mode === "off") return;
  const time = new Date(event.instant).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (mode === "simple") {
    host.notify("Mouvement détecté", `Caméra ${event.camera}`);
    if (!flags.doNotDisturb) say(`${ownerName}, mouvement détecté sur la caméra ${event.camera}.`, { urgent: true });
    return;
  }
  const index = security.cameraNames().indexOf(event.camera);
  const frame = index >= 0 ? security.latestFrame(index) : undefined;
  const personne = frame ? await verifyPerson(frame) : undefined;
  security.annotate(event, personne === undefined ? {} : { personne });
  if (personne === false) return; // un chat, une ombre, la pluie : enregistré, sans alerte
  pages.openPage("securite", undefined, { focus: false });
  void security.recordClip(event.camera, 20).then((video) => video && security.annotate(event, { video }));
  host.notify("Alerte surveillance", `${personne ? "Personne détectée" : "Mouvement"} : caméra ${event.camera} à ${time}`);
  if (phone.enabled && frame) void phone.photo(frame, `Jarvis — ${personne ? "personne détectée" : "mouvement"} sur la caméra ${event.camera} à ${time}.`).catch((e) => console.warn("[téléphone]", e));
  if (env("SURVEILLANCE_DISSUASION") !== "false") {
    if (tapo) void tapo.command(env("SURVEILLANCE_LUMIERES") ?? "tout", { action: "allumer" }).catch(() => undefined);
    say(env("SURVEILLANCE_MESSAGE") ?? "Attention. Vous êtes filmé, et le propriétaire vient d'être prévenu.", { urgent: true });
  }
  actions.add({ outil: "surveillance", resume: `Alerte caméra ${event.camera} (${personne ? "personne" : "mouvement"})`, autorise: true, origine: "automatique" });
}

const pendingVerdicts = new Map<string, (personne: boolean | undefined) => void>();
function verifyPerson(jpeg: Buffer): Promise<boolean | undefined> {
  const win = accueil();
  if (!win) return Promise.resolve(undefined);
  const id = `${Date.now()}-${Math.random()}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingVerdicts.delete(id);
      resolve(undefined);
    }, 5_000);
    pendingVerdicts.set(id, (verdict) => {
      clearTimeout(timer);
      resolve(verdict);
    });
    win.webContents.send("securite:verifier", { id, jpegBase64: jpeg.toString("base64") });
  });
}

/** Début du mode absent (surveillance complète), pour le résumé au retour. */
let absentSince: number | undefined;
/** Début de l'absence, remis à zéro une fois lu (résumé du retour). */
function takeAbsentSince(): number | undefined {
  const since = absentSince;
  absentSince = undefined;
  return since;
}
function setSurveillance(mode: SurveillanceMode): void {
  if (mode === "complete" && security.mode !== "complete") absentSince = Date.now();
  security.mode = mode;
  flags.surveillance = mode;
  broadcast("jarvis:flags", flags);
  updateTray();
  actions.add({ outil: "surveillance", resume: `Mode ${mode}`, autorise: true });
}

// ---------- Mémoire du travail : pseudonymes ----------

const privacy = new Pseudonymizer(config.dataDir, [ownerName]);
function learnTeam(): void {
  const names = (env("EQUIPE") ?? "").split(",").map((n) => n.trim());
  const file = path.join(workFolder, "equipe.txt");
  if (existsSync(file)) names.push(...readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.split(/[;,\t]/)[0]!.trim()));
  privacy.learn(names.filter(Boolean));
}
const pseudonyms = env("TRAVAIL_PSEUDONYMES") !== "false";
const mask = (text: string) => (pseudonyms && privacy.size ? privacy.mask(text) : text);
const unmask = (text: string) => (pseudonyms && privacy.size ? privacy.unmask(text) : text);

/** Données initiales d'une page qui s'ouvre. */
async function pageData(page: PageId | "bulle"): Promise<Record<string, unknown>> {
  const base = { ownerName, flags, page, race: race.active ? race.state : null, meteo: weather.current ?? null };
  switch (page) {
    case "accueil":
    case "travail": {
      const now = new Date();
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59);
      const [events, unread] = await Promise.all([
        agenda?.list(now, endOfDay).catch(() => []) ?? [],
        mail?.search("is:unread in:inbox newer_than:2d -category:promotions -category:social", 8).catch(() => []) ?? [],
      ]);
      const reminders = notes.list(40).filter((n) => n.rappelLe && !n.rappelEnvoye && new Date(n.rappelLe).getTime() < endOfDay.getTime() + 86_400_000);
      return {
        ...base,
        events,
        rappels: reminders.slice(0, 8),
        notes: notes.list(5),
        unread: unread.map((m) => ({ from: m.from.replace(/<.*>/, "").trim(), subject: m.subject })),
        devices: page === "accueil" ? await (tapo?.states().catch(() => []) ?? []) : [],
        pttButton: env("BOUTON_VOLANT_PARLER") ? Number(env("BOUTON_VOLANT_PARLER")) : null,
        reveil: wake?.status() ?? null,
        taches: tasks.running(),
        dispositions: dispositions.list().map((d) => ({ nom: d.nom, pages: d.pages })),
        mentor: learning.mode,
        revisions: learning.stats().aReviser,
      };
    }
    case "ingenieur":
      return { ...base, raceState: race.state ?? null };
    case "code":
    case "rd":
      return { ...base, projet: { vue: page, ...views[page].snapshot() } };
    case "securite":
      return { ...base, cameras: security.streams(), evenements: security.events.slice(0, 30), surveillance: security.armed, mode: security.mode, configure: security.enabled };
    case "performances":
      return { ...base, perf: perf.current ?? (await perf.sample()) ?? null };
    case "diagnostic":
      return { ...base, resultats: lastDiagnostic ?? null, version: app.getVersion() };
    default:
      return base;
  }
}

async function sendPageData(page: PageId): Promise<void> {
  pages.broadcast("page:data", await pageData(page), page);
}

// ---------- Ce que voient les outils ----------

const screens = new ScreenMap();
const pendingCameraRequests = new Map<string, (frames: Array<{ nom: string; jpegBase64: string }>) => void>();

async function captureScreens(): Promise<ScreenShot[]> {
  const displays = screen.getAllDisplays();
  const biggest = displays.reduce((m, d) => ({ width: Math.max(m.width, d.size.width * d.scaleFactor), height: Math.max(m.height, d.size.height * d.scaleFactor) }), { width: 0, height: 0 });
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: biggest });
  return displays.map((display, index) => {
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[index]!;
    const full = source.thumbnail;
    const fullSize = full.getSize();
    const maxWidth = 1568;
    const ratio = fullSize.width > maxWidth ? maxWidth / fullSize.width : 1;
    const image = ratio < 1 ? full.resize({ width: Math.round(fullSize.width * ratio), quality: "good" }) : full;
    const size = image.getSize();
    const physicalWidth = display.size.width * display.scaleFactor;
    return {
      nom: display.label || `Écran ${index + 1}`,
      jpegBase64: image.toJPEG(72).toString("base64"),
      width: size.width,
      height: size.height,
      originX: display.bounds.x * display.scaleFactor,
      originY: display.bounds.y * display.scaleFactor,
      scale: physicalWidth / size.width,
    };
  });
}

function captureCameras(index?: number): Promise<Array<{ nom: string; jpegBase64: string }>> {
  const win = accueil();
  if (!win || !flags.cameras) return Promise.resolve([]);
  const id = `${Date.now()}-${Math.random()}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingCameraRequests.delete(id);
      resolve([]);
    }, 5_000);
    pendingCameraRequests.set(id, (frames) => {
      clearTimeout(timer);
      resolve(frames);
    });
    win.webContents.send("camera:capture", { id, index });
  });
}

function showPanel(panel: { titre: string; markdown?: string; imageDataUrl?: string; modelPath?: string; page?: PageId }): void {
  const modelData = panel.modelPath ? readFileSync(panel.modelPath).toString("base64") : undefined;
  const target: PageId = panel.page ?? "accueil";
  const payload = { titre: unmask(panel.titre), markdown: panel.markdown ? unmask(panel.markdown) : undefined, imageDataUrl: panel.imageDataUrl, modelData };
  const win = pages.openPage(target, undefined, { focus: !pages.gameRunning });
  // Une page qui vient de s'ouvrir attend d'être chargée.
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", () => win.webContents.send("jarvis:panel", payload));
  else win.webContents.send("jarvis:panel", payload);
}

const host: DesktopHost = {
  captureScreens,
  captureCameras,
  workspace,
  show: showPanel,
  notify: (title, body) => new Notification({ title, body: unmask(body), icon: path.join(assets, "icon.png") }).show(),
  pages: {
    open: (page, ecran) => void pages.openPage(page, ecran),
    openMany: (ids) => void pages.openPages(ids),
    close: (page) => (page === "toutes" ? pages.closeAll() : pages.close(page)),
    layout: () => pages.layout(),
  },
  setSurveillance,
  views,
  security,
  perf,
  weather,
};

// ---------- Journal, traçabilité ----------

const journal = new Journal(config.dataDir);
const actions = new ActionLog(config.dataDir);
const versions = new FileVersions(config.dataDir);

// ---------- Ingénieur de course (F1, Le Mans Ultimate) ----------

const race = new RaceManager({
  workspace,
  name: ownerName,
  verbosity: (["minimal", "normal", "bavard"].includes(process.env.INGENIEUR_BAVARDAGE ?? "") ? process.env.INGENIEUR_BAVARDAGE : "normal") as Verbosity,
  f1Port: Number(process.env.F1_UDP_PORT ?? 20777),
  onRadio: (message) => {
    // « Ne pas déranger » coupe tout sauf l'essentiel ; en file d'attente, les infos mineures sautent.
    if (flags.doNotDisturb && message.priority !== "critique") return;
    if (message.priority === "info" && pendingSpeech > 1) return;
    broadcast("jarvis:message", { from: "jarvis", text: `📻 ${message.text}`, radio: true });
    say(message.text, { radio: true, urgent: message.priority === "critique" });
  },
  onState: (state) => {
    broadcast("race:state", state ?? null);
    pages.setGameRunning(race.active || games.active);
    updateGameMode();
  },
  onSessionEnd: (summary, csvPath, state) => {
    journal.add({ demande: `Séance de simulation ${state.jeu} terminée`, reponse: `${summary} Tours enregistrés dans ${csvPath}.`, outils: ["course"] });
    broadcast("jarvis:message", { from: "jarvis", text: `${summary}\n${csvPath}` });
    if (!flags.doNotDisturb) say(`Séance terminée. ${summary} Dis-moi si tu veux que je l'analyse.`);
  },
});
const games = new GameWatcher({
  processes: [...DEFAULT_GAME_PROCESSES, ...(env("JEUX_PROCESSUS") ?? "").split(",").map((s) => s.trim()).filter(Boolean)],
  onChange: (running) => {
    pages.setGameRunning(running.length > 0 || race.active);
    pcCare.setGameManual(undefined);
    updateGameMode();
  },
});

// Santé du PC, puce graphique de l'interface et mode jeu : voir pc-care.ts
function checkLastShutdown() {
  return pcCare.checkLastShutdown();
}
function applyGpuPreference() {
  return pcCare.applyGpuPreference();
}
function updateGameMode(): void {
  pcCare.updateGameMode();
}

// ---------- Apprendre, chercher, calculer ----------

const learning = new Learning(config.dataDir, workspace);
const literature = new Literature({ openAlexKey: env("OPENALEX_CLE"), semanticScholarKey: env("SEMANTIC_SCHOLAR_CLE"), ncbiKey: env("NCBI_CLE") });
const library = new Library({ dataDir: config.dataDir, folder: env("BIBLIOTHEQUE_DOSSIER") ?? path.join(workspace, "bibliotheque"), embedder: env("BIBLIOTHEQUE_SEMANTIQUE") === "false" ? undefined : e5Embedder({ cacheDir: modelCache, threads: tuning.threadsNormal }) });
const lab = new Lab(workspace, assets);
const garage = new Garage(config.dataDir);
const budget = new Budget(config.dataDir);
const localAI = new LocalAI({ url: env("OLLAMA_URL"), model: env("IA_LOCALE_MODELE"), vramGo: () => (hardware.nvidia?.vramMo ?? 0) / 1024 });
const micro = new Microcontrollers(env("ARDUINO_CLI"));
const procedures = new Procedures(workspace, async () => {
  const shots = await captureScreens();
  const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const index = Math.max(0, screen.getAllDisplays().findIndex((d) => d.id === cursor.id));
  const shot = shots[index] ?? shots[0];
  return shot ? Buffer.from(shot.jpegBase64, "base64") : undefined;
});

// ---------- Cerveau, voix, oreilles ----------

const plusHostRef: { current?: PlusHost } = {};
const brain = new Brain({
  dataDir: config.dataDir,
  workspace,
  systemPrompt: () => personaPrompt({ ownerName, workspace, os: "Windows", memories: notes.memories(), workFolder }),
  mcpServers: {
    jarvis: jarvisMcpServer(host, tools, screens, journal, race),
    jarvis_plus: plusMcpServer(new Proxy({} as PlusHost, { get: (_t, key) => (plusHostRef.current as unknown as Record<string | symbol, unknown>)[key] })),
  },
  model: env("CLAUDE_MODEL"),
  workFolder: pseudonyms ? workFolder : undefined,
  onDecision: (tool, input, allowed, reason, trust) => actions.add({ outil: tool, resume: summarizeInput(tool, input), autorise: allowed, ...(reason ? { raison: reason } : {}), ...(trust ? { origine: trust } : {}) }),
  beforeFileChange: (file) => {
    try {
      versions.snapshot(file);
    } catch (error) {
      console.warn("[versions]", error);
    }
  },
});
const voice = new Voice(env("JARVIS_VOICE") ?? DEFAULT_VOICE, env("JARVIS_VOICE_RATE") ?? "+0%", env("JARVIS_VOICE_PITCH") ?? "+0Hz");
const localVoice = new LocalVoice(workspace, { assetsDir: assets, findPython: () => lab.findPython(), threads: () => tuning.threadsVoix });
voice.local = {
  active: () => env("VOIX_MOTEUR") === "locale" && localVoice.installed && !flags.jeu,
  synthesize: (text) => localVoice.synthesize(text, { reference: env("VOIX_REFERENCE"), expressivite: Number((env("VOIX_EXPRESSIVITE") ?? "0.5").replace(",", ".")) || 0.5 }),
};
const sttSetting = env("STT_MODEL") ?? "auto";
const ears = new Ears({ cacheDir: modelCache, model: sttSetting === "auto" ? "onnx-community/whisper-small" : sttSetting, device: env("STT_DEVICE") ?? "dml", threads: (light) => (light ? tuning.threadsJeu : tuning.threadsNormal) });
const voiceLock = new VoiceLock(config.dataDir, wavlmEmbedder({ cacheDir: modelCache, threads: Math.min(4, tuning.threadsNormal) }), "Xenova/wavlm-base-plus-sv", Number(env("VOIX_SEUIL") ?? 0.86));
// Durée pendant laquelle Jarvis écoute la suite sans son nom (réglage modifiable sans redémarrer).
const conversation = new ConversationWindow(() => {
  const seconds = Number((env("CONVERSATION_SECONDS") ?? "20").replace(",", "."));
  return (Number.isFinite(seconds) ? seconds : 20) * 1000;
});
const wakeNames = () => wakeVariants(env("MOT_EVEIL_AUTRES"));

/** File de lecture : les phrases sont synthétisées dans l'ordre et jouées par la fenêtre d'accueil. */
let speechQueue: Promise<void> = Promise.resolve();
let speechGeneration = 0;
let pendingSpeech = 0;

function say(text: string, options: { radio?: boolean; urgent?: boolean } = {}): void {
  // Une alerte critique passe devant : on coupe ce qui était en cours.
  if (options.urgent) stopSpeaking();
  const generation = speechGeneration;
  pendingSpeech += 1;
  speechQueue = speechQueue.then(async () => {
    try {
      if (generation !== speechGeneration) return;
      const audio = await voice.synthesize(unmask(text));
      if (!audio || generation !== speechGeneration) return;
      accueil()?.webContents.send("audio:play", { data: audio.data.toString("base64"), mime: audio.mime, text, radio: options.radio === true });
    } finally {
      pendingSpeech -= 1;
    }
  });
}

function reply(text: string): void {
  if (!text.trim()) return;
  broadcast("jarvis:message", { from: "jarvis", text: unmask(text) });
  say(text);
}

function stopSpeaking(): void {
  speechGeneration += 1;
  broadcast("audio:stop", null);
}

// ---------- Tâches de fond ----------

const tasks = new BackgroundTasks({
  dataDir: config.dataDir,
  run: (consigne, events, signal) =>
    brain.askDetached(
      `[Tâche de fond lancée par Jarvis pour ${ownerName}. Personne ne peut te répondre pendant la tâche : ne pose pas de question, fais des hypothèses raisonnables et dis-les. Termine par un résumé de deux phrases à dire à voix haute.]\n\n${consigne}`,
      { onTool: (name) => events.onTool(toolLabel(name)) },
      signal,
    ),
  onUpdate: (list) => broadcast("taches:data", list.filter((t) => t.etat === "en_cours" || t.etat === "attente")),
  onDone: (task) => {
    const summary = (task.resultat ?? task.erreur ?? "").split(/\n\s*\n/).filter(Boolean).at(-1)?.slice(0, 400) ?? "";
    host.notify(task.etat === "terminee" ? "Tâche terminée" : "Tâche échouée", `${task.titre}${summary ? ` — ${summary}` : ""}`);
    if (task.etat === "terminee") {
      const report = researchFiles.get(task.id);
      const markdown = report && existsSync(report) ? readFileSync(report, "utf8") : task.resultat;
      if (markdown) showPanel({ titre: task.titre, markdown, page: task.page ?? "accueil" });
      if (!flags.doNotDisturb && !race.active) say(`${ownerName}, « ${task.titre} » est terminé. ${summary}`);
    } else if (!flags.doNotDisturb && !race.active) say(`${ownerName}, la tâche « ${task.titre} » n'a pas abouti : ${task.erreur ?? "erreur inconnue"}.`);
  },
});
const researchFiles = new Map<string, string>();

function slugify(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "sujet";
}

function launchResearch(sujet: string, objectif: string | undefined, profondeur: "rapide" | "normale" | "poussee"): string {
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(workspace, "recherches", `${date}-${slugify(sujet)}.md`);
  const task = tasks.launch(`Recherche : ${sujet}`, deepResearchPrompt({ sujet, objectif, profondeur, fichier: file, date }), "rd");
  researchFiles.set(task.id, file);
  return task.id;
}

// ---------- Spotify et réveil ----------

const spotifyState = new JsonStore<{ playlistReveil?: string; jetons?: SpotifyTokens }>(config.dataDir, "spotify", () => ({}));
// Jeton Spotify : dans le coffre chiffré ; sans chiffrement (hors Windows), dans les données de Jarvis.
const spotify = new SpotifyClient({
  get clientId() {
    return env("SPOTIFY_CLIENT_ID");
  },
  load: () => (vault.available ? vault.getJson<SpotifyTokens>("spotify") : spotifyState.read().jetons),
  save: (tokens) => (vault.available ? vault.setJson("spotify", tokens) : spotifyState.update((s) => ({ ...s, jetons: tokens }))),
  fetchFn: resilientFetch(fetch, () => (app.isReady() ? (net.fetch as unknown as typeof fetch) : undefined), "Spotify"),
});
let spotifyDevice: string | undefined;

async function spotifyDeviceId(): Promise<string | undefined> {
  const device = await spotify.ensureDevice(() => void shell.openExternal("spotify:"), { timeoutMs: 20_000, ...(env("SPOTIFY_APPAREIL") ? { preferName: env("SPOTIFY_APPAREIL")! } : {}) });
  spotifyDevice = device?.id;
  return device?.id;
}

async function playWakePlaylist(): Promise<string> {
  const device = await spotifyDeviceId();
  if (!device) return "L'appli Spotify ne répond pas sur ce PC.";
  await spotify.play({ deviceId: device, contextUri: await ensureWakePlaylist() });
  return "La playlist du réveil.";
}

async function ensureWakePlaylist(): Promise<string> {
  const configured = env("SPOTIFY_REVEIL") ? toSpotifyUri(env("SPOTIFY_REVEIL")!) : undefined;
  if (configured) return configured;
  const saved = spotifyState.read().playlistReveil;
  if (saved) return saved;
  const uris: string[] = [];
  for (const q of WAKE_TRACKS) {
    const found = await spotify.search(q, 1).catch(() => []);
    if (found[0]) uris.push(found[0].uri);
  }
  const playlist = await spotify.createPlaylist("Réveil Jarvis", "La playlist du réveil, préparée par Jarvis : douce au début, entraînante ensuite.");
  await spotify.addToPlaylist(playlist.id, uris);
  spotifyState.update((s) => ({ ...s, playlistReveil: playlist.uri }));
  return playlist.uri;
}

const spotifyHelpers: PlusHost["spotify"] = {
  connected: () => spotify.connected,
  connect: async () => {
    if (!spotify.configured) return "Il faut d'abord créer ton appli sur developer.spotify.com (5 minutes, le guide est dans le README) et mettre son Client ID dans SPOTIFY_CLIENT_ID.";
    await spotify.connect((url) => void shell.openExternal(url));
    return "Spotify est relié.";
  },
  play: async (requete) => {
    const device = await spotifyDeviceId();
    if (!device) return "L'appli Spotify ne répond pas sur ce PC.";
    if (!requete) {
      await spotify.play({ deviceId: device });
      return "Lecture.";
    }
    if (/playlist/i.test(requete)) {
      const pl = await spotify.searchPlaylist(requete.replace(/playlist/i, "").trim());
      if (pl) {
        await spotify.play({ deviceId: device, contextUri: pl.uri });
        return `Playlist « ${pl.name} ».`;
      }
    }
    const found = await spotify.search(requete, 10);
    if (!found.length) return `Je n'ai rien trouvé pour « ${requete} ».`;
    await spotify.play({ deviceId: device, uris: found.map((t) => t.uri) });
    return `${found[0]!.name}, ${found[0]!.artists}.`;
  },
  control: async (action, value) => {
    if (action === "pause") await spotify.pause();
    else if (action === "suivant") await spotify.next();
    else if (action === "precedent") await spotify.previous();
    else await spotify.volume(value ?? 50, spotifyDevice);
    return "C'est fait.";
  },
  wakePlaylist: async () => `Playlist du réveil : ${await ensureWakePlaylist()}`,
  setWakePlaylist: async (link) => {
    const uri = toSpotifyUri(link);
    if (!uri) return "Ce lien ne ressemble pas à une playlist Spotify.";
    spotifyState.update((s) => ({ ...s, playlistReveil: uri }));
    return "C'est la playlist du réveil désormais.";
  },
  addToWake: async (requetes) => {
    const uri = await ensureWakePlaylist();
    const id = uri.split(":").at(-1)!;
    const added: string[] = [];
    for (const q of requetes) {
      const t = (await spotify.search(q, 1))[0];
      if (t) {
        await spotify.addToPlaylist(id, [t.uri]);
        added.push(`${t.name} (${t.artists})`);
      }
    }
    return added.length ? `Ajouté : ${added.join(", ")}.` : "Rien trouvé.";
  },
  addCurrentToWake: async () => {
    const now = await spotify.current();
    if (!now?.track) return "Rien ne joue en ce moment.";
    const uri = await ensureWakePlaylist();
    await spotify.addToPlaylist(uri.split(":").at(-1)!, [now.track.uri]);
    return `« ${now.track.name} » ajouté au réveil.`;
  },
};

// ---------- Module Musique de l'accueil (voir music-panel.ts) ----------

const music = new MusicPanel({ spotify, helpers: spotifyHelpers, device: () => spotifyDevice, publish: (state) => pages.broadcast("musique:etat", state, "accueil") });

const planning = new PlanningReader({
  file: () => env("PLANNING_FICHIER"),
  owners: [ownerName, ...(env("PLANNING_NOM") ?? "").split(",").map((s) => s.trim()).filter(Boolean)],
  codes: parseCodes(env("PLANNING_CODES")),
  mask: (text, names) => {
    privacy.learn(names);
    return privacy.mask(text);
  },
  askClaude: async (text) => {
    const r = await brain.ask(
      `Voici le planning de travail de l'équipe d'${ownerName} (les collègues sont pseudonymisés ; ${ownerName} y apparaît sous son prénom). Trouve SES horaires pour chaque jour et réponds UNIQUEMENT par un tableau JSON [{"date":"AAAA-MM-JJ","debut":"HH:MM","fin":"HH:MM","repos":false}] (repos:true sans heures pour un jour de repos ou de congé). Aujourd'hui : ${new Date().toISOString().slice(0, 10)}.\n\n${text.slice(0, 40_000)}`,
      {},
      { separate: true },
    );
    const json = r.text.match(/\[[\s\S]*\]/)?.[0];
    return json ? (JSON.parse(json) as Shift[]) : [];
  },
});

const alarmEnabled = env("REVEIL") !== "off";
const lightTargets = () => (env("REVEIL_LUMIERES") ?? "chambre").split(",").map((s) => s.trim()).filter(Boolean);
let wakeLock: number | undefined;
const wake: WakeUp | undefined = alarmEnabled
  ? new WakeUp({
      dataDir: config.dataDir,
      timeZone: config.timeZone,
      ownerName,
      rules: () => ({
        avantTravailMin: Number(env("REVEIL_AVANT_TRAVAIL") ?? DEFAULT_RULES.avantTravailMin),
        heureParDefaut: env("REVEIL_HEURE") === "aucune" ? undefined : (env("REVEIL_HEURE") ?? DEFAULT_RULES.heureParDefaut),
        joursParDefaut: parseDays(env("REVEIL_JOURS")),
        repos: env("REVEIL_REPOS") ?? "aucun",
        auPlusTot: env("REVEIL_AU_PLUS_TOT") ?? DEFAULT_RULES.auPlusTot,
      }),
      shifts: async () => (await planning.read().catch(() => undefined))?.horaires ?? [],
      music: {
        start: async () => {
          if (!spotify.connected) return false;
          const device = await spotifyDeviceId();
          if (!device) return false;
          await spotify.shuffle(false, device).catch(() => undefined);
          await spotify.volume(15, device).catch(() => undefined);
          await spotify.play({ deviceId: device, contextUri: await ensureWakePlaylist() });
          return true;
        },
        volume: (pct) => spotify.volume(pct, spotifyDevice),
        stop: () => spotify.pause(spotifyDevice),
      },
      ...(tapo
        ? {
            lights: async (level: number) => {
              for (const target of lightTargets()) {
                await tapo.command(target, { luminosite: Math.max(1, Math.round(level * 100)), ...(level < 0.1 ? { couleur: "warmwhite" } : level >= 1 ? { couleur: "daylightwhite" } : {}) }).catch(() => undefined);
              }
            },
          }
        : {}),
      prepareGreeting: prepareMorning,
      say: (text) => reply(text),
      ring: (on) => accueil()?.webContents.send("audio:ring", { on }),
      wakeScreen: () => {
        showHome();
        wakeLock ??= powerSaveBlocker.start("prevent-display-sleep");
        setTimeout(() => {
          if (wakeLock !== undefined) powerSaveBlocker.stop(wakeLock);
          wakeLock = undefined;
        }, 35 * 60_000);
        if (process.platform === "win32") void runPowerShell("(Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void mouse_event(int f,int x,int y,int d,int e);' -Name M -Namespace W -PassThru)::mouse_event(1,1,1,0,0)", 10_000);
      },
      scheduleSystemWake: process.platform === "win32" ? async (at) => void (await runPowerShell(wakeTaskScript(at), 30_000)) : undefined,
      notify: (title, body) => host.notify(title, body),
      onChange: (status) => broadcast("reveil:etat", status),
      musicAfter: () => (env("REVEIL_MUSIQUE_APRES") === "pause" ? "pause" : "continuer"),
    })
  : undefined;

async function prepareMorning(context: { date: string; shift?: Shift | undefined }): Promise<string> {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59);
  const [meteo, events, unread] = await Promise.all([
    weather.refresh().catch(() => weather.current),
    agenda?.list(now, end).catch(() => []) ?? [],
    mail?.search("is:unread in:inbox newer_than:1d -category:promotions -category:social", 6).catch(() => []) ?? [],
  ]);
  await veille.refresh().catch(() => undefined);
  const digest = await veille.digest().catch(() => undefined);
  const data: MorningContext = {
    ownerName,
    date: now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
    meteo,
    poste: context.shift,
    rendezVous: events.filter((e) => !e.allDay).map((e) => ({ titre: e.summary, heure: new Date(e.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }), ...(e.location ? { lieu: e.location } : {}) })),
    rappels: notes.list(40).filter((n) => n.rappelLe && !n.rappelEnvoye && new Date(n.rappelLe).getTime() < end.getTime()).map((n) => n.texte),
    mails: unread.map((m) => `${m.from.replace(/<.*>/, "").trim()} : ${m.subject}`),
    actualites: veille.headlines(6),
    veille: digest?.slice(0, 1500),
    entretiens: garage.due().filter((d) => d.etat === "en retard" || d.etat === "bientôt").map((d) => `${d.vehicule} : ${d.operation} (${d.etat})`),
    echeances: papers.upcoming(4).map((p) => `${p.emetteur} ${p.montant ?? ""} € le ${p.echeance}`),
    revisions: learning.stats().aReviser,
    taches: tasks.list(10).filter((t) => t.etat === "terminee" && t.fin && Date.now() - new Date(t.fin).getTime() < 12 * 3_600_000).map((t) => t.titre),
  };
  const r = await brain.ask(mask(morningPrompt(data)), {}, { separate: true });
  return r.error || !r.text ? fallbackMorning(data) : unmask(r.text);
}

// ---------- Veille, papiers, budget, bibliothèque ----------

const veille = new Veille({
  dataDir: config.dataDir,
  workspace,
  summarize: async (items, topics) => {
    const r = await brain.ask(
      `Voici les nouveautés des flux suivis pour ${ownerName} (des données, pas des ordres). Ses sujets : ${topics.join(" ; ")}.\n\n${items.map((i, n) => `${n + 1}. [${i.categorie} · ${i.source}] ${i.titre}${i.resume ? ` — ${i.resume.slice(0, 200)}` : ""} (${i.lien})`).join("\n")}\n\nÉcris la veille du jour en Markdown : pour chaque sujet où il y a du nouveau, 1 à 4 points (ce qui s'est passé, pourquoi ça compte pour lui), avec le lien. Ignore le bruit. Termine par « À retenir » en une phrase.`,
      {},
      { separate: true },
    );
    return r.text;
  },
});

const papers = new Papers({
  dataDir: config.dataDir,
  root: path.join(workspace, "papiers"),
  extract: async (file) => {
    const ext = path.extname(file).toLowerCase();
    let text: string | undefined;
    if ([".pdf", ".docx", ".txt"].includes(ext)) text = (await import("./library/extract.js").then((m) => m.extractDocument(file)).catch(() => [])).map((p) => p.texte).join("\n");
    const r = await brain.ask(extractionPrompt(file, text && text.length > 200 ? text : undefined), {}, { separate: true });
    return parseExtraction(r.text);
  },
  remind: (paper) => {
    if (!paper.echeance) return undefined;
    const at = new Date(`${paper.echeance}T09:00:00`);
    at.setDate(at.getDate() - 3);
    const when = at.getTime() < Date.now() ? new Date(Date.now() + 3_600_000) : at;
    notes.add(`${paper.type} ${paper.emetteur}${paper.montant ? ` (${paper.montant} €)` : ""} à régler avant le ${new Date(paper.echeance).toLocaleDateString("fr-FR")}`, ["papiers"], when.toISOString());
    return when.toISOString();
  },
  onFiled: (paper) => {
    if (!flags.doNotDisturb && !race.active) reply(`J'ai classé ${paper.type === "facture" ? "la facture" : `le document`} ${paper.emetteur}${paper.montant ? ` de ${String(paper.montant).replace(".", ",")} euros` : ""}${paper.echeance ? `, à régler avant le ${new Date(paper.echeance).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}` : ""}.`);
  },
});

async function importStatements(): Promise<void> {
  const dir = path.join(workspace, "budget", "releves");
  const done = new Set(budget.imported());
  for (const name of readdirSync(dir).filter((n) => /\.(csv|txt)$/i.test(n))) {
    const file = path.join(dir, name);
    if (done.has(file)) continue;
    try {
      const r = await budget.importFile(file, name.replace(/\.[^.]+$/, ""));
      actions.add({ outil: "budget", resume: `Relevé ${name} : ${r.ajoutees} opérations`, autorise: true, origine: "automatique" });
    } catch (error) {
      console.warn("[budget]", name, error);
    }
  }
}

// ---------- Routines et minuteurs ----------

const routines = new Routines(config.dataDir);
const timers = new Timers(config.dataDir, (timer) => {
  accueil()?.webContents.send("audio:ring", { on: true, court: true });
  reply(`${ownerName}, ton minuteur ${timer.libelle ? `« ${timer.libelle} » ` : ""}de ${sayDuration(timer.duree)} est terminé.`);
  host.notify("Minuteur", timer.libelle ?? sayDuration(timer.duree));
});

// Exécution des routines : voir routine-runner.ts
function launchRoutine(name: string): Promise<string> {
  return routineRunner.launchRoutine(name);
}

function applyDisposition(name: string, speak = true): string {
  const d = dispositions.get(name);
  if (!d) return `Je ne connais pas la disposition « ${name} ». Disponibles : ${dispositions.list().map((x) => x.nom).join(", ")}.`;
  pages.applyDisposition(d);
  updateTray();
  const text = `Disposition ${d.nom.toLowerCase()}.`;
  if (speak) say(text);
  return text;
}

// ---------- OBD et port série ----------

let obdPort: { port: string; baud: number } | undefined;
async function findObd(): Promise<{ port: string; baud: number; version: string } | null> {
  const r = await runPowerShell(findElmScript(), 90_000);
  const found = JSON.parse(r.stdout.trim() || "null") as { port: string; baud: number; version: string } | null;
  if (found) obdPort = { port: found.port, baud: found.baud };
  return found;
}
async function obd(commands: string[], port?: string): Promise<Record<string, string>> {
  if (process.platform !== "win32") throw new Error("La lecture OBD se fait depuis Windows.");
  const target = port ? { port, baud: obdPort?.port === port ? obdPort.baud : Number(env("OBD_BAUD") ?? 38400) } : (obdPort ?? (await findObd()));
  if (!target) throw new Error("Adaptateur ELM327 introuvable : branche-le sur la prise OBD, mets le contact, et appaire-le en Bluetooth dans Windows.");
  const r = await runPowerShell(elmScript(target.port, commands, target.baud), 120_000);
  if (r.code !== 0) throw new Error(r.stderr || "Pas de réponse de l'adaptateur.");
  return JSON.parse(r.stdout.trim()) as Record<string, string>;
}

// ---------- Sauvegardes ----------

const backups = new BackupService({
  sources: [
    { nom: "jarvis-memoire", dossier: config.dataDir },
    ...["projets", "travail", "apprentissage", "recherches", "procedures", "papiers", "budget", "labo", "simu", "veille", "ia"].map((d) => ({ nom: d, dossier: path.join(workspace, d) })),
  ],
  destination: path.join(workspace, "sauvegardes"),
  copie: env("SAUVEGARDE_COPIE"),
  canRun: () => !flags.jeu,
  onDone: (result) => {
    actions.add({ outil: "sauvegarde", resume: `${result.fichiers} fichiers → ${result.fichier}`, autorise: true, origine: "automatique" });
    try {
      saveSecretCopy();
    } catch (error) {
      console.warn("[coffre portable]", error);
    }
  },
});

const SECRET_COPY = "jarvis-coffre.chiffre";
/** Copie des mots de passe chiffrée par le mot de passe de sauvegarde (restaurable sur un autre PC). */
function saveSecretCopy(): string | undefined {
  const password = env("SAUVEGARDE_MOT_DE_PASSE");
  if (!password || !vault.available) return undefined;
  const coffre: Record<string, string> = {};
  for (const key of vault.keys()) {
    const value = vault.get(key);
    if (value !== undefined && key !== "SAUVEGARDE_MOT_DE_PASSE") coffre[key] = value;
  }
  const sealed = sealSecrets({ version: 1, date: new Date().toISOString(), coffre, reglages: readFileSync(envFile, "utf8") }, password);
  const targets = [path.join(workspace, "sauvegardes"), env("SAUVEGARDE_COPIE")].filter((d): d is string => Boolean(d));
  for (const dir of targets) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, SECRET_COPY), sealed);
    } catch (error) {
      console.warn("[coffre portable]", dir, error);
    }
  }
  return path.join(targets[0]!, SECRET_COPY);
}

function secretCopyDate(): string | undefined {
  const file = path.join(workspace, "sauvegardes", SECRET_COPY);
  if (!existsSync(file)) return undefined;
  return statSync(file).mtime.toLocaleDateString("fr-FR");
}

// ---------- Hôte des outils supplémentaires ----------

// Outils supplémentaires de Claude (hôte) : voir plus-host.ts

// ---------- Veilleur des connexions ----------

const watchdog = new Watchdog({
  // Pendant un jeu, pas de contrôles (ils réveillent le réseau et la carte graphique).
  run: () => (flags.jeu ? Promise.resolve([]) : runDiagnostic()),
  watched: ["claude", "google", "spotify", "tapo", "cameras", "sauvegardes", "voix", "micro", "disque"],
  onLost: (lost) => {
    const text = describeLost(lost);
    host.notify(lost.length > 1 ? "Des éléments ont décroché" : `${lost[0]!.titre} a décroché`, text);
    actions.add({ outil: "veilleur", resume: `Décroché : ${lost.map((r) => r.titre).join(", ")}`, autorise: true, origine: "automatique" });
    if (phone.enabled) void phone.text(`Jarvis : ${lost.length > 1 ? "des éléments ont décroché" : "un élément a décroché"}.\n${text}\nDétails : page Diagnostic.`).catch(() => undefined);
  },
  onBack: (back) => {
    host.notify("De nouveau connecté", back.map((r) => r.titre).join(", "));
    actions.add({ outil: "veilleur", resume: `Revenu : ${back.map((r) => r.titre).join(", ")}`, autorise: true, origine: "automatique" });
  },
});

// ---------- Diagnostic ----------

let lastDiagnostic: Awaited<ReturnType<typeof runChecks>> | undefined;
let senses = { micro: false, cameras: 0, gestes: false, detecteur: false };

// Bilan de Jarvis (page Diagnostic) : voir diagnostic-checks.ts
async function runDiagnostic() {
  lastDiagnostic = await diagnostics.runDiagnostic();
  return lastDiagnostic;
}

// ---------- Ce que dit Alex ----------

/** Ouvrir, fermer ou déplacer des pages, sans passer par Claude (instantané). */
function handlePageCommand(command: string): boolean {
  const disposition = parseDispositionCommand(command, dispositions.list());
  if (disposition) {
    if (disposition.action === "appliquer") reply(applyDisposition(disposition.nom, false));
    else if (disposition.action === "echanger") reply(pages.swap() ? "J'échange." : "Il n'y a rien à échanger.");
    else reply(plusHostRef.current!.saveCurrentDisposition(disposition.nom));
    conversation.open();
    return true;
  }
  const parsed = parsePageCommand(command);
  if (!parsed) return false;
  const names = (ids: PageId[]) => ids.map((id) => pageInfo(id).titre.toLowerCase()).join(" et ");
  let text: string;
  if (parsed.action === "fermer") {
    if (parsed.pages === "toutes") {
      pages.closeAll();
      text = "Je ferme tout.";
    } else {
      parsed.pages.forEach((id) => pages.close(id));
      text = parsed.pages.includes("accueil") ? "L'accueil reste toujours ouvert." : "C'est fermé.";
    }
  } else if (parsed.action === "deplacer") {
    parsed.pages.forEach((id) => pages.move(id, parsed.ecran));
    text = `${names(parsed.pages)} : écran ${parsed.ecran === "principal" ? "principal" : `de ${parsed.ecran}`}.`;
  } else if (parsed.pages.length > 1) {
    pages.openPages(parsed.pages.slice(0, 3));
    text = "Voilà, côte à côte.";
  } else {
    pages.openPage(parsed.pages[0]!, parsed.ecran);
    text = pageInfo(parsed.pages[0]!).annonce;
  }
  reply(text);
  conversation.open();
  return true;
}

/** Réflexes : exécutés sur le PC sans passer par Claude. Renvoie faux si l'intention n'est pas permise. */
// Réflexes (demandes simples exécutées sans Claude) : voir intent-actions.ts
function runIntent(intent: Intent, trust: "proprietaire" | "inconnu"): Promise<boolean> {
  return intentActions.runIntent(intent, trust);
}

let enrollIndex = 0;
function resetEnrollIndex(): void {
  enrollIndex = 0;
}

async function handleCommand(text: string, source: "voix" | "clavier", trust: "proprietaire" | "inconnu" = "proprietaire"): Promise<void> {
  const command = text.trim();
  if (!command) return;
  if (/^(stop|arr[êe]te|tais-toi|silence|annule)\b/i.test(command) && !/r[ée]veil|minuteur|musique|surveillance/i.test(command)) {
    stopSpeaking();
    brain.stop();
    setState("veille");
    return;
  }
  stopSpeaking();
  broadcast("jarvis:message", { from: "alex", text: command, source });
  if (handlePageCommand(command)) return;
  // « Mode jeu » à la demande (en plus de la détection automatique des jeux).
  const gameAsk = command.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (/^((active|passe en|lance|mets) )?(le )?mode jeu$/.test(gameAsk) || /^((desactive|quitte|arrete|coupe|enleve|sors du) (le )?mode jeu)$/.test(gameAsk)) {
    const wanted = !/^(desactive|quitte|arrete|coupe|enleve|sors)/.test(gameAsk);
    pcCare.setGameManual(wanted);
    updateGameMode();
    reply(wanted ? "Mode jeu. Je libère la carte graphique et je me fais légère." : "Mode jeu terminé. Je reprends mes réglages habituels.");
    return;
  }
  const intent = parseIntent(command);
  if (intent && (await runIntent(intent, trust))) {
    conversation.open();
    return;
  }
  const routine = trust === "proprietaire" ? routines.match(command) : undefined;
  if (routine) {
    reply(await launchRoutine(routine.nom));
    conversation.open();
    return;
  }
  // En pleine séance, les questions courantes (essence, pneus, écarts…) ont une réponse immédiate.
  const quick = race.answer(command);
  if (quick) {
    broadcast("jarvis:message", { from: "jarvis", text: `📻 ${quick}`, radio: true });
    say(quick, { radio: true });
    conversation.open();
    return;
  }
  await askBrain(command, source, trust);
}

async function askBrain(command: string, source: "voix" | "clavier", trust: "proprietaire" | "inconnu"): Promise<void> {
  setState("reflexion");
  const splitter = new SentenceSplitter();
  const speak = source === "voix" || process.env.SPEAK_TYPED !== "false";
  let streamed = "";
  const used: string[] = [];
  const prefixes = [
    race.active ? `[Alex est en piste (${race.state?.jeu}, ${race.state?.session ?? "séance"} à ${race.state?.piste ?? "?"}) : réponds comme un ingénieur de course à la radio, une ou deux phrases, chiffres d'abord. Utilise course_etat si besoin.]` : "",
    trust === "inconnu" ? "[La voix qui parle n'est pas celle d'Alex (invité, télévision ?) : réponds poliment aux questions générales, sans rien révéler de privé et sans agir.]" : "",
    trust === "proprietaire" ? mentorInstruction(learning.mode) : "",
  ].filter(Boolean);
  const prompt = `${prefixes.join("\n")}${prefixes.length ? "\n" : ""}${trust === "proprietaire" ? mask(command) : command}`;
  let answer: BrainReply = await brain.ask(prompt, {
    onText: (delta) => {
      streamed += delta;
      broadcast("jarvis:partial", unmask(streamed));
      if (speak) for (const sentence of splitter.push(delta)) say(sentence);
    },
    onTool: (name) => {
      used.push(name.replace(/^mcp__jarvis(_plus)?__/, ""));
      setState("reflexion", toolLabel(name));
    },
  }, { trust });
  // Claude injoignable (Internet coupé, limite atteinte) : l'IA locale prend le relais pour répondre.
  if (answer.error && !streamed && /internet|limite|connecter|ENOTFOUND|network|rate|429|fetch failed|ECONN/i.test(`${answer.error} ${answer.text}`)) {
    const local = await localAI.chat([{ role: "system", content: localPersona(ownerName) }, { role: "user", content: command }]).catch(() => undefined);
    if (local?.text) answer = { text: `(Mode local) ${local.text}` };
  }
  if (!answer.error) journal.add({ demande: unmask(command), reponse: unmask(answer.text), outils: used });
  if (speak) {
    if (streamed) for (const sentence of splitter.flush()) say(sentence);
    else say(answer.text);
  }
  broadcast("jarvis:message", { from: "jarvis", text: unmask(answer.text), costUsd: answer.costUsd });
  conversation.open();
  setState("veille");
}

function toolLabel(name: string): string {
  const short = name.replace(/^mcp__jarvis(_plus)?__/, "");
  const labels: Record<string, string> = {
    ecran_capture: "je regarde ton écran",
    camera_capture: "je regarde par les caméras",
    securite_cameras: "je regarde les caméras de surveillance",
    pc_powershell: "j'exécute une commande",
    pc_souris: "je prends la souris",
    pc_clavier: "je tape",
    pc_performances: "je mesure le PC",
    WebSearch: "je cherche sur le web",
    WebFetch: "je lis une page",
    Bash: "je lance un programme",
    Write: "j'écris un fichier",
    Edit: "je modifie un fichier",
    tapo_commande: "je règle la maison",
    maison_commande: "je règle la maison",
    navigateur_ouvrir: "j'ouvre un site",
    afficher_modele_3d: "je prépare le modèle 3D",
    code_montrer: "j'affiche le code",
    rd_montrer: "j'affiche le projet",
    meteo: "je regarde la météo",
    litterature_chercher: "je lis la littérature scientifique",
    bibliotheque_chercher: "je cherche dans ta bibliothèque",
    labo_python: "je calcule",
    recherche_approfondie: "je lance la recherche",
    tache_lancer: "je lance une tâche de fond",
    travail_fichier_lire: "je lis le document de travail",
    obd_codes_defaut: "je lis la voiture",
    budget_bilan: "je fais les comptes",
    ia_locale_demander: "je demande à l'IA locale",
  };
  return labels[short] ?? short.replace(/_/g, " ");
}

// ---------- Messages de l'interface ----------

ipcMain.on("audio:utterance", async (_event, payload: Float32Array | { samples: Float32Array; pendantParole?: boolean }) => {
  if (!flags.micro) return;
  const samples = payload instanceof Float32Array ? payload : payload.samples;
  const duringSpeech = !(payload instanceof Float32Array) && payload.pendantParole === true;
  try {
    // Apprentissage de la voix : chaque phrase sert d'empreinte.
    if (voiceLock.isEnrolling && !duringSpeech) {
      const left = await voiceLock.addEnrollmentSample(samples);
      if (left === 0) reply("Merci. Je reconnais ta voix désormais. Une voix inconnue pourra me poser des questions, mais pas me donner d'ordres.");
      else {
        enrollIndex = ENROLL_PHRASES.length - left;
        reply(`Phrase suivante : ${ENROLL_PHRASES[enrollIndex]}`);
      }
      return;
    }
    if (!duringSpeech) setState("ecoute", "transcription");
    const [transcript, identity] = await Promise.all([ears.transcribe(samples), voiceLock.verify(samples).catch(() => ({ owner: true, score: undefined, reason: "erreur" }))]);
    const trust = identity.owner ? "proprietaire" : "inconnu";
    // Pendant que Jarvis parle : seuls « stop », « attends » ou « Jarvis… » l'interrompent, et seulement avec la voix d'Alex.
    if (duringSpeech) {
      if (isInterruption(transcript) && identity.owner) {
        stopSpeaking();
        const wake2 = detectWake(transcript, true);
        if (wake2.command && !/^(stop|arr[êe]te|attends|tais-toi|silence)\b/i.test(wake2.command)) await handleCommand(wake2.command, "voix", trust);
        else conversation.open();
      }
      return;
    }
    // Démonstration en cours : on note ce qu'Alex dit, sauf « c'est fini ».
    if (procedures.isRecording) {
      const intent = parseIntent(transcript.replace(/^jarvis[ ,]*/i, ""));
      if (intent?.type === "demonstration" && intent.action === "fin") await runIntent(intent, trust);
      else procedures.narrate(transcript);
      return setState("veille");
    }
    // Réveil qui sonne : « je suis debout », « encore cinq minutes » suffisent, sans dire « Jarvis ».
    if (wake?.ringing) {
      const intent = parseIntent(transcript.replace(/^jarvis[ ,]*/i, ""));
      if (intent?.type === "reveil") {
        await runIntent(intent, trust);
        return setState("veille");
      }
    }
    const result = detectWake(transcript, conversation.active, wakeNames());
    // Discrétion : ce qui n'est pas adressé à Jarvis n'est ni affiché ni gardé.
    if (!result.awake) return setState("veille");
    broadcast("jarvis:heard", { transcript: unmask(transcript), awake: true, voix: identity.owner ? "Alex" : "inconnue", bip: env("ECOUTE_SON") !== "false" && !conversation.active });
    if (!result.command) {
      conversation.open();
      say(pickGreeting());
      return setState("ecoute");
    }
    await handleCommand(result.command, "voix", trust);
  } catch (error) {
    console.error("[oreilles]", error);
    setState("veille");
  }
});

function pickGreeting(): string {
  const greetings = [`Oui, ${ownerName} ?`, "Je t'écoute.", "À ton service.", `Je suis là, ${ownerName}.`];
  return greetings[Math.floor(Math.random() * greetings.length)]!;
}

ipcMain.on("audio:clap", () => {
  if (!flags.micro) return;
  // Double claquement pendant le réveil : « je suis debout ».
  if (wake?.ringing) return void wake.confirmAwake();
  conversation.open();
  setState("ecoute");
  say(pickGreeting());
});

ipcMain.on("audio:speaking", (_event, speaking: boolean) => {
  flags.speaking = speaking;
  setState(speaking ? "parole" : "veille");
  if (!speaking) conversation.open();
});

ipcMain.on("input:text", (_event, text: string) => void handleCommand(text, "clavier"));
ipcMain.on("jarvis:stop", () => {
  stopSpeaking();
  brain.stop();
});
ipcMain.on("jarvis:listen", () => {
  conversation.open();
  setState("ecoute");
});
ipcMain.on("jarvis:show", showHome);
ipcMain.on("jarvis:toggle", (_event, name: "micro" | "cameras" | "doNotDisturb") => setFlag(name, !flags[name]));
ipcMain.on("page:open", (_event, id: PageId) => {
  // Le bouton « Accueil » ramène l'accueil au premier plan (même réduit ou caché derrière une page).
  if (id === "accueil") showHome();
  else if (PAGES.some((p) => p.id === id)) pages.openPage(id);
});
ipcMain.on("page:close", (event) => {
  const page = PAGES.find((p) => pages.window(p.id)?.webContents === event.sender);
  if (page) pages.close(page.id);
});

ipcMain.on("gesture", (_event, gesture: string) => {
  switch (gesture) {
    case "Palm_Stop": // main ouverte immobile : « stop »
      if (flags.speaking) stopSpeaking();
      break;
    case "Swipe_Droite": // balayage : les pages changent d'écran (jamais pendant une partie)
    case "Swipe_Gauche":
      if (!pages.gameRunning && !race.active) pages.swap(gesture === "Swipe_Droite" ? "droite" : "gauche");
      break;
    case "Pointing_Up": // index levé : « je t'écoute »
      conversation.open();
      setState("ecoute");
      break;
    case "Thumb_Up": // pouce levé : « oui » pendant un échange, « je suis debout » au réveil
      if (wake?.ringing) void wake.confirmAwake();
      else if (conversation.active) void handleCommand("Oui, vas-y.", "voix");
      break;
    case "Victory": // V : affiche ou cache la bulle
      toggleBubble();
      break;
    case "ILoveYou": // 🤟 : ne pas déranger
      setFlag("doNotDisturb", !flags.doNotDisturb);
      say(flags.doNotDisturb ? "Mode ne pas déranger activé." : "Je suis de nouveau là.");
      break;
  }
});

ipcMain.on("camera:frames", (_event, payload: { id: string; frames: Array<{ nom: string; jpegBase64: string }> }) => {
  pendingCameraRequests.get(payload.id)?.(payload.frames);
  pendingCameraRequests.delete(payload.id);
});

ipcMain.on("securite:verdict", (_event, payload: { id: string; personne?: boolean }) => {
  pendingVerdicts.get(payload.id)?.(payload.personne);
  pendingVerdicts.delete(payload.id);
});

ipcMain.on("senses:etat", (_event, state: typeof senses) => (senses = { ...senses, ...state }));

ipcMain.handle("page:data", (_event, page: PageId | "bulle") => pageData(page));

ipcMain.handle("tapo:toggle", async (_event, payload: { nom: string; allume: boolean }) => {
  return tapo?.command(payload.nom, { action: payload.allume ? "allumer" : "eteindre" });
});

ipcMain.handle("securite:armer", (_event, armed: boolean) => {
  setSurveillance(armed ? "simple" : "off");
  return security.armed;
});

ipcMain.handle("securite:mode", (_event, mode: SurveillanceMode) => {
  if (["off", "simple", "complete"].includes(mode)) setSurveillance(mode);
  return security.mode;
});

ipcMain.handle("projet:fichier", (_event, payload: { vue: "code" | "rd"; chemin: string }) => {
  views[payload.vue].show(views[payload.vue].folder ?? workspace, { fichier: payload.chemin });
});

ipcMain.handle("diagnostic:run", async () => {
  const results = await runDiagnostic();
  return { resultats: results, resume: sayDiagnostic(results), version: app.getVersion() };
});

ipcMain.handle("jeu:etat", () => flags.jeu);
ipcMain.handle("journal:lire", (_event, date?: string) => {
  const jours = actions.days().slice(0, 60);
  const jour = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : (jours[0] ?? new Date().toISOString().slice(0, 10));
  const crashFile = path.join(userDir, "erreurs.log");
  const erreurs = existsSync(crashFile)
    ? readFileSync(crashFile, "utf8").split(/\n(?=\[\d{4}-)/).filter(Boolean).slice(-15).reverse().map((e) => ({ t: e.slice(1, 25), texte: e.slice(27, 600).trim() }))
    : [];
  return { jours, jour, entrees: actions.day(jour).map((e) => ({ ...e, resume: unmask(e.resume) })).reverse(), erreurs, enPanne: [...watchdog.down] };
});
ipcMain.handle("musique:etat", () => music.refresh());
ipcMain.handle("musique:commande", (_event, payload: Parameters<MusicPanel["command"]>[0]) => music.command(payload));

ipcMain.handle("disposition:appliquer", (_event, name: string) => applyDisposition(name, false));

ipcMain.handle("reveil:passer", async (_event, payload: { date: string; aucun: boolean }) => {
  if (!wake) return null;
  if (payload.aucun) await wake.setOverride({ date: payload.date, aucun: true });
  else await wake.clearOverride(payload.date);
  return wake.status();
});

const MIME: Record<string, string> = { ".html": "text/html", ".htm": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".mp4": "video/mp4", ".stl": "model/stl", ".wasm": "application/wasm" };

// ---------- Démarrage ----------

app.on("second-instance", showHome);
app.on("before-quit", () => (quitting = true));

/** Modèle de reconnaissance vocale selon la carte graphique (STT_MODEL=auto). */
async function chooseSpeechModel(): Promise<void> {
  try {
    const si = await import("systeminformation");
    const [graphics, cpu] = await Promise.all([si.graphics(), si.cpu()]);
    hardware = buildProfile(cpu, totalmem(), graphics.controllers);
    tuning = tune(hardware);
    pages.hiddenTtlMs = tuning.pagesCacheesMs;
    void applyGpuPreference();
    if (sttSetting !== "auto") return;
    const vram = Math.max(0, ...graphics.controllers.map((c) => c.vram ?? 0));
    const choice = pickSpeechModel(vram || undefined);
    ears.configure(choice.model, env("STT_DEVICE") ?? choice.device);
  } catch {
    // on garde whisper-small
  }
}

// Mises à jour automatiques : voir updates.ts
const updates = new Updates({ env, notify: (title, body) => host.notify(title, body), reply: (text) => reply(text) });
function checkUpdates(announce = false): Promise<string> {
  return updates.check(announce);
}

// ---------- Réglages ----------

const settings = new SettingsStore(envFile, vault);

/** Ce qui change à chaud après un enregistrement. */
function applySettings(keys: string[]): void {
  if (keys.includes("JARVIS_VILLE")) void weather.setCity(env("JARVIS_VILLE"));
  if (keys.includes("VOIX_MOTEUR") && env("VOIX_MOTEUR") === "locale" && localVoice.installed && !flags.jeu) void localVoice.start();
  if (keys.includes("MODE_JEU")) updateGameMode();
  if (keys.includes("GPU_INTERFACE")) void applyGpuPreference();
  if (keys.includes("VOIX_SEUIL") && env("VOIX_SEUIL")) voiceLock.setThreshold(Number(env("VOIX_SEUIL")!.replace(",", ".")));
  if (keys.some((k) => k.startsWith("REVEIL") || k.startsWith("PLANNING"))) void wake?.refresh();
}

// Boutons de la page Réglages (Tester, Connecter…) : voir settings-actions.ts
function runSettingAction(id: string) {
  return settingActions.runSettingAction(id);
}

ipcMain.handle("reglages:lire", () => settings.view());
ipcMain.handle("reglages:enregistrer", (_event, payload: { valeurs: Record<string, string>; effacer?: string[] }) => {
  const result = settings.save(payload.valeurs ?? {}, payload.effacer ?? []);
  applySettings(result.enregistres);
  actions.add({ outil: "reglages", resume: `Réglages modifiés : ${result.enregistres.join(", ")}`, autorise: true });
  return result;
});
ipcMain.handle("reglages:action", (_event, id: string) => runSettingAction(id));
ipcMain.handle("reglages:choisir", async (_event, payload: { type: "fichier" | "dossier"; filtres?: Array<{ name: string; extensions: string[] }> }) => {
  const result = await dialog.showOpenDialog({ properties: [payload.type === "dossier" ? "openDirectory" : "openFile"], ...(payload.filtres ? { filters: payload.filtres } : {}) });
  return result.canceled ? undefined : result.filePaths[0];
});
ipcMain.on("reglages:ouvrir", (_event, groupe: string) => {
  const win = pages.openPage("reglages");
  const send = () => win.webContents.send("reglages:groupe", groupe);
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
  else send();
});
ipcMain.on("jarvis:redemarrer", () => {
  quitting = true;
  app.relaunch();
  app.exit(0);
});

void app.whenReady().then(async () => {
  app.setAppUserModelId("fr.alex.jarvis");

  // Ancien coffre (versions 0.3.3 et avant, illisible au lancement) : converti une fois, puis Jarvis redémarre.
  if (process.platform === "win32" && isLegacyVault(userDir)) {
    try {
      const count = migrateLegacyVault(userDir, (data) => safeStorage.decryptString(data), vault);
      console.log(`[coffre] ${count} secret(s) convertis`);
      quitting = true;
      app.relaunch();
      app.exit(0);
      return;
    } catch (error) {
      reportCrash(new Error(`Coffre-fort : conversion impossible (${error instanceof Error ? error.message : error}). Retape tes mots de passe dans la page Réglages.`));
    }
  }

  // apercu://code/… et apercu://rd/… : fichiers du projet affiché ; apercu://securite/… : images des caméras. Jamais en dehors.
  protocol.handle("apercu", (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    let data: Buffer | undefined;
    if (url.hostname === "securite") {
      const target = insideProject(path.join(workspace, "securite"), relative);
      data = target && existsSync(target) ? readFileSync(target) : undefined;
    } else data = (url.hostname === "rd" ? views.rd : views.code).read(relative);
    if (!data) return new Response("Introuvable", { status: 404 });
    return new Response(new Uint8Array(data), { headers: { "content-type": MIME[path.extname(relative).toLowerCase()] ?? "application/octet-stream" } });
  });

  const homeWindow = pages.openPage("accueil", undefined, { show: !process.argv.includes("--hidden") });
  if (startupTest) {
    const fail = (why: string) => {
      console.error(`[test] ÉCHEC : ${why}`);
      app.exit(1);
    };
    setTimeout(() => fail("l'accueil ne s'est pas chargé en 2 minutes"), 120_000).unref();
    homeWindow.webContents.on("render-process-gone", (_e, d) => fail(`page d'accueil plantée (${d.reason})`));
    homeWindow.webContents.on("preload-error", (_e, _p, error) => fail(`préchargement : ${error.message}`));
    homeWindow.webContents.on("console-message", (event) => {
      if (event.level === "error" && /Uncaught|is not defined|is not a function|Cannot read/i.test(event.message)) fail(`erreur dans l'accueil : ${event.message}`);
    });
    homeWindow.webContents.once("did-finish-load", () => {
      // Laisse tourner Jarvis 20 secondes (services, pages) avant de conclure.
      setTimeout(async () => {
        const diag = await runDiagnostic().catch((error) => fail(`diagnostic : ${error instanceof Error ? error.message : error}`));
        if (!diag) return;
        const ok = `[test] démarrage OK — version ${app.getVersion()}, ${diag.length} contrôles du diagnostic exécutés`;
        console.log(ok);
        writeFileSync(path.join(workspace, "test-demarrage.txt"), ok);
        quitting = true;
        app.exit(0);
      }, 20_000);
    });
  }
  // Le micro et les caméras sont autorisés pour l'interface de Jarvis, et seulement elle.
  homeWindow.webContents.session.setPermissionRequestHandler((contents, permission, callback) => {
    callback(contents.getURL().startsWith("file://") && ["media", "notifications", "clipboard-sanitized-write"].includes(permission));
  });
  homeWindow.webContents.session.setPermissionCheckHandler((_contents, permission) => permission === "media" || permission === "notifications");
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
  });
  screen.on("display-added", () => pages.relayout());
  screen.on("display-removed", () => pages.relayout());
  screen.on("display-metrics-changed", () => pages.relayout());

  bubble = createBubble();
  tray = new Tray(nativeImage.createFromPath(path.join(assets, "icon.png")).resize({ width: 16, height: 16 }));
  tray.on("click", showHome);
  updateTray();

  globalShortcut.register("Control+Alt+J", toggleBubble);
  globalShortcut.register("Control+Alt+Space", () => {
    conversation.open();
    setState("ecoute");
    say(pickGreeting());
  });
  globalShortcut.register("Control+Alt+S", () => {
    stopSpeaking();
    brain.stop();
  });

  learnTeam();
  await chooseSpeechModel();
  ears.warmUp();
  weather.start();
  perf.start();
  games.start();
  void security.start();
  if (env("SURVEILLANCE") && ["simple", "complete"].includes(env("SURVEILLANCE")!)) setSurveillance(env("SURVEILLANCE") as SurveillanceMode);
  new Proactive({
    dataDir: config.dataDir,
    timeZone: config.timeZone,
    ownerName,
    // Avec le réveil, le point du matin se fait au réveil (après « je suis debout »).
    briefing: process.env.BRIEFING_TIME === "off" || alarmEnabled ? undefined : { hour: config.briefingHour, minute: config.briefingMinute },
    eventReminderMinutes: config.eventReminderMinutes,
    notes,
    agenda,
    mail,
    brain,
    say: (text) => reply(text),
    notify: host.notify,
    canSpeak: () => !flags.doNotDisturb && !race.active,
  }).start();
  race.start();
  wake?.start();
  timers.restore();
  veille.start();
  papers.start();
  backups.start();
  if (!startupTest) {
    watchdog.start();
    setTimeout(() => void checkLastShutdown().catch((e) => console.warn("[santé]", e)), 2 * 60_000);
  }
  // Un souci de mise à jour ne doit jamais empêcher Jarvis de démarrer.
  void updates.setup().catch((error) => {
    updates.fail(error);
    console.warn("[mise à jour]", error);
  });
  // Bibliothèque et relevés : un passage au démarrage, puis régulièrement.
  setTimeout(() => void library.scan().catch((e) => console.warn("[bibliothèque]", e)), 3 * 60_000);
  setInterval(() => !flags.jeu && void library.scan().catch(() => undefined), 15 * 60_000);
  setTimeout(() => void importStatements(), 2 * 60_000);
  setInterval(() => void importStatements(), 60 * 60_000);
  // L'accueil se met à jour (rendez-vous, rappels) toutes les minutes.
  setInterval(() => void sendPageData("accueil"), 60_000);
  // Musique en cours : toutes les 5 secondes quand l'accueil est visible.
  setInterval(() => {
    if (pages.window("accueil")?.isVisible() && spotify.connected) void music.refresh();
  }, 5_000);
  setTimeout(() => void runDiagnostic().catch(() => undefined), 45_000);

  // Le connecteur pour l'app Claude du téléphone et les raccourcis iPhone, si un secret est réglé.
  if (config.webhookSecret) {
    createWebhookServer(config.webhookSecret, {
      createMcp: () => createMcpServer(tools, ownerName),
      onIncoming: async (message) => {
        inbox.add(message);
        broadcast("jarvis:message", { from: "jarvis", text: `${message.app ?? "SMS"} de ${message.de} : ${message.contenu}` });
        if (!flags.doNotDisturb) say(`${ownerName}, tu as un message de ${message.de}.`);
        return { recu: true };
      },
    }).listen(config.port, "127.0.0.1");
  }
});

app.on("will-quit", () => {
  watchdog.stop();
  globalShortcut.unregisterAll();
  race.stop();
  security.stop();
  weather.stop();
  perf.stop();
  games.stop();
  wake?.stop();
  veille.stop();
  papers.stop();
  backups.stop();
  if (procedures.isRecording) procedures.stop();
  localVoice.stop();
  void browser?.close();
});

// Sans fenêtre visible, Jarvis reste actif dans la zone de notification.
app.on("window-all-closed", () => undefined);











/** Services partagés avec les modules de Jarvis (chaque module reçoit seulement ceux dont il a besoin). */
export interface JarvisServices {
  actions: typeof actions;
  agenda: typeof agenda;
  applyDisposition: typeof applyDisposition;
  askBrain: typeof askBrain;
  backups: typeof backups;
  brain: typeof brain;
  broadcast: typeof broadcast;
  budget: typeof budget;
  checkUpdates: typeof checkUpdates;
  config: typeof config;
  conversation: typeof conversation;
  dispositions: typeof dispositions;
  ears: typeof ears;
  env: typeof env;
  envFile: typeof envFile;
  findObd: typeof findObd;
  flags: typeof flags;
  games: typeof games;
  garage: typeof garage;
  handleCommand: typeof handleCommand;
  hardware: typeof hardware;
  host: typeof host;
  lab: typeof lab;
  launchResearch: typeof launchResearch;
  launchRoutine: typeof launchRoutine;
  learning: typeof learning;
  library: typeof library;
  literature: typeof literature;
  localAI: typeof localAI;
  localVoice: typeof localVoice;
  mask: typeof mask;
  micro: typeof micro;
  movedSecrets: typeof movedSecrets;
  notes: typeof notes;
  obd: typeof obd;
  ownerName: typeof ownerName;
  pages: typeof pages;
  papers: typeof papers;
  pcCare: typeof pcCare;
  perf: typeof perf;
  phone: typeof phone;
  planning: typeof planning;
  playWakePlaylist: typeof playWakePlaylist;
  plusHostRef: typeof plusHostRef;
  privacy: typeof privacy;
  procedures: typeof procedures;
  race: typeof race;
  reply: typeof reply;
  resetEnrollIndex: typeof resetEnrollIndex;
  routines: typeof routines;
  runDiagnostic: typeof runDiagnostic;
  say: typeof say;
  secretCopyDate: typeof secretCopyDate;
  security: typeof security;
  sendPageData: typeof sendPageData;
  senses: typeof senses;
  setFlag: typeof setFlag;
  setSurveillance: typeof setSurveillance;
  settings: typeof settings;
  showPanel: typeof showPanel;
  spotify: typeof spotify;
  spotifyDevice: typeof spotifyDevice;
  spotifyHelpers: typeof spotifyHelpers;
  takeAbsentSince: typeof takeAbsentSince;
  tapo: typeof tapo;
  tapoCache: typeof tapoCache;
  tasks: typeof tasks;
  timers: typeof timers;
  tuning: typeof tuning;
  updateTray: typeof updateTray;
  vault: typeof vault;
  veille: typeof veille;
  versions: typeof versions;
  voice: typeof voice;
  voiceLock: typeof voiceLock;
  wake: typeof wake;
  weather: typeof weather;
  workFolder: typeof workFolder;
  workspace: typeof workspace;
}

const diagnostics = createDiagnostics({ localAI, ears, env, localVoice, voice, voiceLock, agenda, tapo, security, phone, spotify, planning, wake, backups, vault, lab, library, micro, perf, secretCopyDate, senses: () => senses, updateStatus: () => updates.status, gpuPreferenceNote: () => pcCare.gpuNote(), hardware: () => hardware, tuning: () => tuning, movedSecrets: () => movedSecrets });

const settingActions = createSettingActions({ agenda, backups, checkUpdates, conversation, env, envFile, handleCommand, host, localAI, localVoice, phone, planning, reply, say, settings, spotifyHelpers, tapo, tapoCache, vault, wake, weather, workspace });

const pcCare = createPcCare({ actions, brain, broadcast, config, ears, env, flags, games, host, localAI, localVoice, ownerName, pages, perf, race, updateTray, workspace, hardware: () => hardware, tuning: () => tuning });

const intentActions = createIntentActions({ askBrain, backups, env, learning, notes, playWakePlaylist, procedures, reply, resetEnrollIndex, sendPageData, setFlag, setSurveillance, spotify, spotifyHelpers, tapo, timers, voiceLock, wake, spotifyDevice: () => spotifyDevice });

const routineRunner = createRoutineRunner({ actions, agenda, applyDisposition, pages, phone, playWakePlaylist, reply, routines, security, setFlag, setSurveillance, spotify, spotifyHelpers, takeAbsentSince, tapo, wake });

connectPlusHost({ actions, applyDisposition, backups, budget, dispositions, findObd, garage, lab, launchResearch, launchRoutine, learning, library, literature, localAI, mask, micro, obd, ownerName, pages, papers, plusHostRef, privacy, procedures, routines, runDiagnostic, showPanel, spotify, spotifyHelpers, tasks, timers, updateTray, veille, versions, wake, workFolder, workspace, pcCare });
