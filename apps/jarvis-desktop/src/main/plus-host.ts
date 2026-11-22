import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { protectedTarget } from "../shared/policy.js";
import { recycleScript } from "./actions.js";
import { listBackups } from "./backup.js";
import { pageInfo } from "./pages/catalog.js";
import { runPowerShell } from "./pc.js";
import { WakeUp } from "./reveil/alarm.js";
import { runRoutine } from "./routines.js";
import { serialMonitorScript } from "./serial.js";
import { readWorkFile, unmaskWorkFile } from "./workfiles.js";
import path from "node:path";
import type { JarvisServices } from "./main.js";

/**
 * Ce que les outils supplémentaires de Claude peuvent faire sur le PC (dispositions, recherche, bibliothèque, labo, garage, budget, papiers, sauvegardes, routines, minuteurs, port série…). Branché sur plusHostRef.
 */

export type PlusHostDeps = Pick<JarvisServices, "actions" | "applyDisposition" | "backups" | "budget" | "dispositions" | "findObd" | "garage" | "lab" | "launchResearch" | "launchRoutine" | "learning" | "library" | "literature" | "localAI" | "mask" | "micro" | "obd" | "ownerName" | "pages" | "papers" | "plusHostRef" | "privacy" | "procedures" | "routines" | "runDiagnostic" | "showPanel" | "spotify" | "spotifyHelpers" | "tasks" | "timers" | "updateTray" | "veille" | "versions" | "wake" | "workFolder" | "workspace">;

export function connectPlusHost(d: PlusHostDeps) {
  const { actions, applyDisposition, backups, budget, dispositions, findObd, garage, lab, launchResearch, launchRoutine, learning, library, literature, localAI, mask, micro, obd, ownerName, pages, papers, plusHostRef, privacy, procedures, routines, runDiagnostic, showPanel, spotify, spotifyHelpers, tasks, timers, updateTray, veille, versions, wake, workFolder, workspace } = d;
  plusHostRef.current = {
    workspace,
    dispositions,
    applyDisposition: (nom) => applyDisposition(nom, false),
    saveCurrentDisposition: (nom) => {
      const current = pages.current();
      if (!current.length) return "Aucune page n'est ouverte : ouvre d'abord les pages à enregistrer.";
      const saved = dispositions.save({ nom, pages: current.slice(0, 3).map((p) => ({ page: p.page, ecran: p.ecran === "principal" ? "centre" : p.ecran })) });
      updateTray();
      return `Disposition « ${saved.nom} » enregistrée : ${saved.pages.map((p) => `${pageInfo(p.page).titre} à ${p.ecran}`).join(", ")}.`;
    },
    wake: wake ?? (null as unknown as WakeUp),
    spotify: spotifyHelpers,
    tasks,
    launchTask: (titre, consigne, page) => tasks.launch(titre, mask(consigne), page).id,
    launchResearch,
    literature,
    library,
    learning,
    lab,
    veille,
    routines,
    runRoutine: launchRoutine,
    timers: { add: (s, l) => `Minuteur ${timers.add(s, l).id} lancé.`, list: () => timers.list() },
    garage,
    obd,
    findObd,
    procedures,
    runProcedure: (nom, parametres) => {
      const text = procedures.read(nom);
      if (!text) throw new Error(`Procédure « ${nom} » inconnue.`);
      return tasks.launch(`Procédure : ${nom}`, `Refais cette procédure qu'${ownerName} t'a apprise, sur son PC, avec les outils pc_* et des captures d'écran (ecran_capture avant chaque clic, vérification après). Préfère les raccourcis et les commandes aux clics.${parametres ? `\nParamètres du jour : ${parametres}` : ""}\n\n${text}`).id;
    },
    localAI,
    micro,
    serialMonitor: async (port, baud, seconds, send) => (await runPowerShell(serialMonitorScript(port, baud, seconds, send), (seconds + 15) * 1000)).stdout,
    budget,
    papers,
    actions,
    versions,
    recycle: async (paths) => {
      const bad = paths.find(protectedTarget);
      if (bad) throw new Error(`${bad} est protégé.`);
      if (process.platform !== "win32") throw new Error("La corbeille de Windows n'existe que sous Windows.");
      const r = await runPowerShell(recycleScript(paths), 60_000);
      return r.stdout.trim() || r.stderr.trim();
    },
    readWorkFile: (file, feuille) => readWorkFile(path.resolve(workFolder, file), privacy, feuille),
    unmaskFile: (file) => unmaskWorkFile(path.resolve(workspace, file), privacy),
    backups,
    listBackups: () => listBackups(path.join(workspace, "sauvegardes")).slice(0, 30),
    restoreFromBackup: async (archive, entry, destination) => {
      const file = path.resolve(path.join(workspace, "sauvegardes"), archive);
      if (!file.startsWith(path.join(workspace, "sauvegardes"))) throw new Error("Archive hors du dossier des sauvegardes.");
      const files = unzipSync(new Uint8Array(await readFile(file)), { filter: (f) => f.name === entry });
      const data = files[entry];
      if (!data) throw new Error(`« ${entry} » n'est pas dans cette archive.`);
      mkdirSync(destination, { recursive: true });
      const target = path.join(destination, path.basename(entry));
      if (existsSync(target)) versions.snapshot(target);
      writeFileSync(target, data);
      return `Restauré dans ${target}.`;
    },
    diagnostic: () => runDiagnostic(),
    showImage: async (titre, file, page) => {
      const ext = path.extname(file).toLowerCase().replace(".", "") || "png";
      showPanel({ titre, imageDataUrl: `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${(await readFile(file)).toString("base64")}`, ...(page ? { page } : {}) });
    },
  };
}
