import { app } from "electron";

/**
 * Mises à jour : la version installée vérifie toutes les 6 heures les nouvelles
 * versions publiées sur GitHub (dépôt Jarvis) ou à l'adresse MISE_A_JOUR_URL,
 * les télécharge en arrière-plan et les installe à la fermeture de Jarvis.
 */

type AutoUpdater = (typeof import("electron-updater"))["autoUpdater"];

export class Updates {
  status = "Vérification des mises à jour pas encore faite.";
  private updater: AutoUpdater | undefined;

  constructor(
    private readonly options: {
      env: (name: string) => string | undefined;
      notify: (title: string, body: string) => void;
      reply: (text: string) => void;
    },
  ) {}

  async setup(): Promise<void> {
    if (!app.isPackaged) {
      this.status = "Mode développement : mets à jour avec « git pull » puis « pnpm start ».";
      return;
    }
    // electron-updater est un module CommonJS : selon le chargement, autoUpdater est direct ou sous « default ».
    const mod = (await import("electron-updater")) as unknown as { autoUpdater?: AutoUpdater; default?: { autoUpdater?: AutoUpdater } };
    const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater;
    if (!autoUpdater) {
      this.status = "Impossible de vérifier : module de mise à jour introuvable.";
      return;
    }
    this.updater = autoUpdater;
    const url = this.options.env("MISE_A_JOUR_URL");
    if (url) autoUpdater.setFeedURL({ provider: "generic", url });
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("update-not-available", () => (this.status = `À jour (vérifié à ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}).`));
    autoUpdater.on("download-progress", (p) => (this.status = `Téléchargement de la mise à jour : ${Math.round(p.percent)} %.`));
    autoUpdater.on("update-downloaded", (info) => {
      this.status = `Version ${info.version} prête : elle s'installe au prochain redémarrage de Jarvis.`;
      this.options.notify("Mise à jour de Jarvis", `Version ${info.version} prête. Elle s'installera quand tu redémarreras Jarvis (Réglages → Redémarrer).`);
    });
    autoUpdater.on("error", (error) => (this.status = `Impossible de vérifier : ${/404|private|authentication/i.test(String(error)) ? "le dépôt GitHub de Jarvis est privé (rends-le public, ou règle MISE_A_JOUR_URL)" : String(error).slice(0, 120)}`));
    void this.check();
    setInterval(() => void this.check(), 6 * 3_600_000);
  }

  /** Un souci au démarrage du module ne doit jamais empêcher Jarvis de démarrer. */
  fail(error: unknown): void {
    this.status = `Impossible de vérifier : ${error instanceof Error ? error.message : String(error)}`;
  }

  async check(announce = false): Promise<string> {
    if (!this.updater) {
      if (announce) this.options.reply(this.status);
      return this.status;
    }
    try {
      const result = await this.updater.checkForUpdates();
      const latest = result?.updateInfo.version;
      if (latest && latest !== app.getVersion()) this.status = `Version ${latest} trouvée, téléchargement en cours.`;
    } catch {
      // le message est mis par l'évènement « error »
    }
    if (announce) this.options.reply(this.status);
    return this.status;
  }
}
