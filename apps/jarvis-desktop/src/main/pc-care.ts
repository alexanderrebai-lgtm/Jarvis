import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { constants as osConstants, setPriority, uptime } from "node:os";
import { app, ipcMain, shell } from "electron";
import { describeProfile } from "./hardware.js";
import { analyzeHealth, collectHealth, GameRecorder, HEALTH_ACTIONS, healthReport, healthSummaryForWeb, runHealthAction, type Finding, type HealthActionId, type HealthRaw } from "./pc-health.js";
import path from "node:path";
import { analyzeComponents, canClose, closeProgram, collectComponents } from "./pc-components.js";
import { PcTuning, TWEAKS } from "./pc-tuning.js";
import type { JarvisServices } from "./main.js";

/**
 * Soin du PC : bilan de santé (page Santé du PC, recherche de solutions en ligne, rapport, bilan après un arrêt brutal), puce graphique de l'interface (Ryzen « G ») et mode jeu (la carte graphique et le processeur reviennent au jeu).
 */

export type PcCareDeps = Pick<JarvisServices, "actions" | "brain" | "broadcast" | "config" | "ears" | "env" | "flags" | "games" | "host" | "localAI" | "localVoice" | "ownerName" | "pages" | "perf" | "race" | "updateTray" | "workspace"> & {
  hardware: () => JarvisServices["hardware"];
  tuning: () => JarvisServices["tuning"];
};

export function createPcCare(d: PcCareDeps) {
  const { actions, brain, broadcast, config, ears, env, flags, games, host, localAI, localVoice, ownerName, pages, perf, race, updateTray, workspace, hardware, tuning } = d;
  // ---------- Santé du PC ----------

  const reportsDir = path.join(workspace, "rapports");
  const gameRecorder = new GameRecorder(reportsDir);
  let lastHealth: { raw: HealthRaw; constats: Finding[]; date: string; analyseWeb?: string } | undefined;

  const machineName = () => describeProfile(hardware(), tuning()).split(" · calculs")[0]!;

  async function healthCheck(): Promise<NonNullable<typeof lastHealth>> {
    const raw = await collectHealth(gameRecorder);
    lastHealth = { raw, constats: analyzeHealth(raw, { alimentation: env("PC_ALIMENTATION") }), date: new Date().toISOString() };
    actions.add({ outil: "santé du PC", resume: lastHealth.constats.map((c) => `${c.gravite} : ${c.titre}`).join(" ; ").slice(0, 400), autorise: true });
    return lastHealth;
  }

  /** Recherche en ligne : Claude cherche les solutions connues pour ce matériel et ces symptômes. */
  async function healthWebAdvice(): Promise<{ texte: string; actions: Array<{ id: HealthActionId; libelle: string }> }> {
    const health = lastHealth ?? (await healthCheck());
    const allowed = Object.entries(HEALTH_ACTIONS).map(([id, libelle]) => `${id} (${libelle})`).join(", ");
    const r = await brain.ask(
      `Tu es l'expert matériel de ${ownerName}. Voici le bilan de son PC (aucune donnée personnelle) :\n${healthSummaryForWeb(health.raw, health.constats, machineName(), env("PC_ALIMENTATION"))}\n\n` +
        "Cherche sur Internet (WebSearch, WebFetch) les causes et solutions connues pour CE matériel et CES symptômes : arrêts brutaux en jeu, pics de consommation de la carte graphique, versions de pilote ou de BIOS problématiques, réglages recommandés pour un simulateur comme Le Mans Ultimate. " +
        "Réponds en français, en tutoyant, avec : 1) la cause la plus probable et pourquoi ; 2) au plus 6 actions classées de la plus utile à la moins utile, chacune en une ou deux phrases concrètes ; 3) les sources (liens). " +
        `Quand une action correspond à un bouton de Jarvis, ajoute à la fin de la ligne la balise [action:ID], avec ID parmi : ${allowed}. N'invente pas d'autre balise. Ne propose rien de risqué (overclocking, registre à la main, logiciels douteux).`,
      {},
      { separate: true },
    );
    const ids = [...new Set([...r.text.matchAll(/\[action:([a-z-]+)\]/g)].map((m) => m[1] as HealthActionId).filter((id) => id in HEALTH_ACTIONS))];
    const texte = r.text.replace(/\s*\[action:[a-z-]+\]/g, "").trim();
    health.analyseWeb = texte;
    return { texte, actions: ids.map((id) => ({ id, libelle: HEALTH_ACTIONS[id] })) };
  }

  function saveHealthReport(): string | undefined {
    if (!lastHealth) return undefined;
    mkdirSync(reportsDir, { recursive: true });
    const file = path.join(reportsDir, `sante-${lastHealth.date.slice(0, 16).replace(/[:T]/g, "-")}.md`);
    writeFileSync(file, healthReport(lastHealth.raw, lastHealth.constats, { machine: machineName(), ...(lastHealth.analyseWeb ? { analyseWeb: lastHealth.analyseWeb } : {}) }));
    return file;
  }

  /** Après un redémarrage qui suit un arrêt brutal : bilan automatique et message. */
  async function checkLastShutdown(): Promise<void> {
    if (process.platform !== "win32" || uptime() > 30 * 60) return;
    const seenFile = path.join(config.dataDir, "dernier-arret-vu.txt");
    const seen = existsSync(seenFile) ? readFileSync(seenFile, "utf8").trim() : "";
    const health = await healthCheck();
    const last = health.raw.arretsBrutaux[0];
    if (!last || last.date <= seen) return;
    writeFileSync(seenFile, last.date);
    const at = new Date(last.date).toLocaleString("fr-FR", { weekday: "long", hour: "2-digit", minute: "2-digit" });
    const kind = last.bugcheck === 0 ? "s'est éteint brutalement" : "a planté (écran bleu)";
    host.notify("Arrêt brutal du PC", `Le PC ${kind} ${at}. Bilan prêt : page Santé du PC.`);
    broadcast("jarvis:message", { from: "jarvis", text: `Le PC ${kind} ${at}. J'ai fait le bilan : ouvre la page Santé du PC.` });
  }

  ipcMain.handle("sante:bilan", async (_event, refresh?: boolean) => {
    const health = refresh || !lastHealth ? await healthCheck() : lastHealth;
    return { ...health, machine: machineName(), alimentation: env("PC_ALIMENTATION") ?? null, enJeu: flags.jeu };
  });
  async function healthAction(id: string): Promise<{ ok: boolean; message: string }> {
    if (!(id in HEALTH_ACTIONS)) return { ok: false, message: "Action inconnue." };
    const nvidia = lastHealth?.raw.nvidia ?? (await collectHealth(gameRecorder)).nvidia;
    const message = await runHealthAction(id as HealthActionId, nvidia, (url) => void shell.openExternal(url));
    actions.add({ outil: "santé du PC", resume: `${HEALTH_ACTIONS[id as HealthActionId]} : ${message}`.slice(0, 400), autorise: true });
    return { ok: true, message };
  }
  ipcMain.handle("sante:action", (_event, id: string) => healthAction(id));
  ipcMain.handle("sante:web", async () => {
    try {
      return { ok: true, ...(await healthWebAdvice()) };
    } catch (error) {
      return { ok: false, texte: `Recherche impossible : ${error instanceof Error ? error.message : String(error)}`, actions: [] };
    }
  });
  ipcMain.handle("sante:rapport", () => {
    const file = saveHealthReport();
    if (file) void shell.openPath(file);
    return file ?? null;
  });

  // ---------- Composants et optimisations ----------

  const pcTuning = new PcTuning(config.dataDir);
  const logChange = (resume: string) => actions.add({ outil: "optimisation du PC", resume: resume.slice(0, 400), autorise: true });

  async function componentsReport() {
    const raw = await collectComponents();
    return { rapports: analyzeComponents(raw), processus: raw.processus.map((p) => ({ ...p, fermable: canClose(p.nom) })) };
  }

  async function applyTweak(id: string, undo = false): Promise<{ ok: boolean; message: string }> {
    const r = id === "fichier-echange-auto" ? await pcTuning.automaticPagefile() : id === "plan-equilibre" ? await pcTuning.balancedPlan() : await pcTuning.apply(id, undo);
    logChange(`${undo ? "Annulé" : "Appliqué"} : ${TWEAKS.find((t) => t.id === id)?.titre ?? id} → ${r.message}`);
    return r;
  }

  async function setStartupProgram(nom: string, actif: boolean): Promise<{ ok: boolean; message: string }> {
    const entry = (await pcTuning.state()).demarrage.find((e) => e.nom.toLowerCase() === nom.toLowerCase());
    if (!entry) return { ok: false, message: `${nom} n'est pas dans les programmes au démarrage.` };
    const r = await pcTuning.setStartup(entry, actif);
    logChange(`Démarrage : ${r.message}`);
    return r;
  }

  async function closeProgramByName(nom: string, id?: number): Promise<{ ok: boolean; message: string }> {
    const target = id !== undefined ? { id, nom } : (await collectComponents()).processus.find((p) => p.nom.toLowerCase() === nom.toLowerCase());
    if (!target) return { ok: false, message: `${nom} n'est pas parmi les programmes ouverts les plus gourmands.` };
    const r = await closeProgram(target.id, target.nom);
    logChange(r.message);
    return r;
  }

  ipcMain.handle("sante:composants", () => componentsReport());
  ipcMain.handle("sante:optimisations", () => pcTuning.state());
  ipcMain.handle("sante:optimiser", (_event, payload: { id: string; annuler?: boolean }) => applyTweak(payload.id, payload.annuler === true));
  ipcMain.handle("sante:demarrage", (_event, payload: { nom: string; actif: boolean }) => setStartupProgram(payload.nom, payload.actif));
  ipcMain.handle("sante:fermer", (_event, payload: { id: number; nom: string }) => closeProgramByName(payload.nom, payload.id));

  // ---------- Puce graphique de l'interface ----------

  let gpuPreferenceNote = "";
  /**
   * Avec un processeur à puce graphique intégrée (Ryzen « G »), l'affichage de Jarvis peut tourner sur cette puce :
   * la carte NVIDIA reste entière pour les jeux et l'IA. Réglage Windows « préférence graphique » de Jarvis.exe,
   * appliqué au prochain démarrage de Jarvis.
   */
  async function applyGpuPreference(): Promise<void> {
    if (process.platform !== "win32" || !app.isPackaged) return;
    const choice = env("GPU_INTERFACE") ?? "auto";
    const key = "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences";
    const value = choice === "integree" || (choice === "auto" && hardware().integre) ? "GpuPreference=1;" : choice === "nvidia" ? "GpuPreference=2;" : undefined;
    const args = value ? ["add", key, "/v", process.execPath, "/t", "REG_SZ", "/d", value, "/f"] : ["delete", key, "/v", process.execPath, "/f"];
    await new Promise<void>((resolve) => execFile("reg", args, { windowsHide: true, timeout: 10_000 }, () => resolve()));
    gpuPreferenceNote = value === "GpuPreference=1;" ? `interface sur la puce intégrée (${hardware().integre?.modele ?? "processeur"})` : value ? "interface sur la carte NVIDIA" : "choix laissé à Windows";
  }

  // ---------- Mode jeu : la carte graphique et le processeur reviennent au jeu ----------

  /** Choix manuel (menu de l'icône) ; undefined = automatique selon les jeux détectés. */
  let gameManual: boolean | undefined;
  function updateGameMode(): void {
    const auto = env("MODE_JEU") !== "off" && (games.active || race.active);
    void applyGameMode(gameManual ?? auto);
  }

  /** Choix manuel du mode jeu (menu, voix) ; undefined = automatique. */
  function setGameManual(value: boolean | undefined): void {
    gameManual = value;
  }
  function gameManualChoice(): boolean | undefined {
    return gameManual;
  }
  function gpuNote(): string {
    return gpuPreferenceNote;
  }

  async function applyGameMode(on: boolean): Promise<void> {
    if (on === flags.jeu) return;
    flags.jeu = on;
    broadcast("jarvis:flags", flags);
    updateTray();
    // Voix locale (plusieurs Go sur la carte graphique) : arrêtée, la voix en ligne prend le relais.
    // IA locale (Ollama) : modèles déchargés de la carte graphique. Pages fermées : mémoire libérée.
    if (on) {
      localVoice.stop();
      void localAI.unloadAll().catch(() => undefined);
      pages.releaseHidden();
    }
    // Reconnaissance vocale : petit modèle sur le processeur pendant le jeu.
    ears.setLight(on);
    // Mesures du PC plus espacées.
    perf.setInterval(on ? 20_000 : 3_000);
    setLowPriority(on);
    // Température et puissance de la carte graphique notées pendant la partie (utile après un arrêt brutal).
    if (on) gameRecorder.start();
    else gameRecorder.stop();
    actions.add({ outil: "mode jeu", resume: on ? `Activé${games.games.length ? ` (${games.games.join(", ")})` : ""} : voix locale arrêtée, reconnaissance vocale allégée, animations en pause.` : "Désactivé : Jarvis reprend ses réglages habituels.", autorise: true, origine: "automatique" });
    if (!on && env("VOIX_MOTEUR") === "locale" && localVoice.installed) setTimeout(() => !flags.jeu && void localVoice.start(), 30_000);
  }

  /** Pendant un jeu, tous les processus de Jarvis passent en priorité basse (Windows donne la main au jeu). */
  function setLowPriority(low: boolean): void {
    const level = low ? osConstants.priority.PRIORITY_BELOW_NORMAL : osConstants.priority.PRIORITY_NORMAL;
    const pids = new Set<number>([process.pid, ...app.getAppMetrics().map((m) => m.pid), ...(localVoice.pid ? [localVoice.pid] : [])]);
    for (const pid of pids) {
      try {
        setPriority(pid, level);
      } catch {
        // processus déjà terminé ou protégé
      }
    }
  }

  return { checkLastShutdown, applyGpuPreference, updateGameMode, setGameManual, gameManualChoice, gpuNote, componentsReport, tuningState: () => pcTuning.state(), applyTweak, setStartupProgram, closeProgramByName, healthCheck, healthAction };
}
