import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { runProcess } from "./lab.js";

/**
 * Voix locale : Chatterbox multilingue sur la carte graphique, dans un
 * environnement Python à part (Documents\Jarvis\voix). Jarvis démarre le petit
 * serveur à la demande ; si la voix locale ne répond pas, il reprend la voix
 * Microsoft en ligne.
 */

export class LocalVoice {
  readonly dir: string;
  private server: ChildProcess | undefined;
  private starting: Promise<boolean> | undefined;
  private readonly token = randomBytes(12).toString("hex");
  status: "absente" | "installee" | "demarrage" | "prete" | "erreur" = "absente";
  device: string | undefined;
  lastError: string | undefined;

  constructor(
    workspace: string,
    private readonly options: { assetsDir: string; findPython: () => Promise<string | undefined>; port?: number; fetchFn?: typeof fetch },
  ) {
    this.dir = path.join(workspace, "voix");
    mkdirSync(this.dir, { recursive: true });
    if (this.installed) this.status = "installee";
  }

  private get python(): string {
    return process.platform === "win32" ? path.join(this.dir, ".venv", "Scripts", "python.exe") : path.join(this.dir, ".venv", "bin", "python");
  }

  get installed(): boolean {
    return existsSync(this.python) && existsSync(path.join(this.dir, ".installee"));
  }

  private get port(): number {
    return this.options.port ?? 8897;
  }

  /** Installe Python, PyTorch (carte graphique NVIDIA) et Chatterbox : plusieurs Go, 10 à 20 minutes. */
  async install(onStep: (step: string) => void = () => undefined): Promise<string> {
    const python = await this.options.findPython();
    if (!python) return "Python n'est pas installé. Dans PowerShell : winget install -e --id Python.Python.3.12, puis redémarre Jarvis et recommence.";
    if (!existsSync(this.python)) {
      onStep("Création de l'environnement");
      const venv = await runProcess(python, ["-m", "venv", path.join(this.dir, ".venv")], { timeoutMs: 300_000 });
      if (venv.code !== 0) return `Création de l'environnement impossible : ${venv.stderr.slice(-400)}`;
    }
    const pip = (args: string[], label: string, timeoutMs = 3_600_000) => {
      onStep(label);
      return runProcess(this.python, ["-m", "pip", "install", "--disable-pip-version-check", ...args], { timeoutMs });
    };
    await pip(["--upgrade", "pip"], "Mise à jour de pip", 300_000);
    // PyTorch avec la carte graphique NVIDIA (CUDA) ; sans NVIDIA, la version processeur (plus lente).
    const cuda = await pip(["torch", "torchaudio", "--index-url", "https://download.pytorch.org/whl/cu124"], "Téléchargement de PyTorch pour la carte graphique (environ 2,5 Go)");
    if (cuda.code !== 0) {
      const cpu = await pip(["torch", "torchaudio"], "PyTorch (processeur)");
      if (cpu.code !== 0) return `Installation de PyTorch impossible : ${cpu.stderr.slice(-500)}`;
    }
    const tts = await pip(["chatterbox-tts"], "Téléchargement de Chatterbox");
    if (tts.code !== 0) return `Installation de Chatterbox impossible : ${tts.stderr.slice(-500)}`;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path.join(this.dir, ".installee"), new Date().toISOString());
    this.status = "installee";
    return "Voix locale installée. Au premier essai, le modèle (environ 2 Go) se télécharge encore une fois : patiente une ou deux minutes.";
  }

  /** Démarre le serveur de voix (le modèle se charge en 20 à 60 secondes). */
  start(): Promise<boolean> {
    if (this.status === "prete" && this.server && this.server.exitCode === null) return Promise.resolve(true);
    if (this.starting) return this.starting;
    if (!this.installed) return Promise.resolve(false);
    this.status = "demarrage";
    this.starting = new Promise<boolean>((resolve) => {
      const child = spawn(this.python, [path.join(this.options.assetsDir, "voix", "serveur_voix.py"), "--port", String(this.port), "--jeton", this.token], {
        cwd: this.dir,
        env: { ...process.env, HF_HOME: path.join(this.dir, "modeles"), PYTHONIOENCODING: "utf-8" },
        windowsHide: true,
      });
      this.server = child;
      let stderr = "";
      const timer = setTimeout(() => finish(false, "le modèle met trop de temps à se charger"), 600_000);
      const finish = (ok: boolean, error?: string) => {
        clearTimeout(timer);
        this.starting = undefined;
        this.status = ok ? "prete" : "erreur";
        if (error) this.lastError = error;
        resolve(ok);
      };
      child.stdout.on("data", (d: Buffer) => {
        const line = d.toString();
        const m = line.match(/"appareil":\s*"(\w+)"/);
        if (m) {
          this.device = m[1];
          finish(true);
        }
      });
      child.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));
      child.on("exit", () => {
        this.server = undefined;
        if (this.status !== "prete") finish(false, stderr.split("\n").filter(Boolean).slice(-2).join(" ") || "le serveur de voix s'est arrêté");
        else this.status = "erreur";
      });
    });
    return this.starting;
  }

  stop(): void {
    this.server?.kill();
    this.server = undefined;
    if (this.installed) this.status = "installee";
  }

  /** Une phrase en audio WAV, ou undefined (la voix en ligne prend alors le relais). */
  async synthesize(text: string, options: { reference?: string | undefined; expressivite?: number } = {}): Promise<Buffer | undefined> {
    if (!(await this.start())) return undefined;
    const res = await (this.options.fetchFn ?? fetch)(`http://127.0.0.1:${this.port}/dire`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-jeton": this.token },
      body: JSON.stringify({ texte: text, ...(options.reference ? { reference: options.reference } : {}), expressivite: options.expressivite ?? 0.5 }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      this.lastError = ((await res.json().catch(() => ({}))) as { erreur?: string }).erreur ?? `erreur ${res.status}`;
      return undefined;
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
