import { spawn } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Labo de calcul : un environnement Python à part (numpy, scipy, sympy,
 * pandas, matplotlib, pint…) où Jarvis exécute ses calculs au lieu de les
 * estimer, avec la boîte à outils jarvis_labo (résistance des matériaux,
 * électronique, impression 3D) et le cahier d'expériences de chaque projet.
 */

export const LAB_PACKAGES = ["numpy", "scipy", "sympy", "pandas", "matplotlib", "pint", "openpyxl", "schemdraw"];

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  figures: string[];
  timedOut: boolean;
}

export function runProcess(command: string, args: string[], options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, PYTHONIOENCODING: "utf-8", ...options.env }, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? 120_000);
    child.stdout.on("data", (d: Buffer) => (stdout = (stdout + d.toString()).slice(-200_000)));
    child.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-50_000)));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

export class Lab {
  readonly dir: string;
  private python: string | undefined;

  constructor(workspace: string, private readonly assetsDir: string) {
    this.dir = path.join(workspace, "labo");
    mkdirSync(path.join(this.dir, "scripts"), { recursive: true });
    mkdirSync(path.join(this.dir, "figures"), { recursive: true });
  }

  private venvPython(): string {
    return process.platform === "win32" ? path.join(this.dir, ".venv", "Scripts", "python.exe") : path.join(this.dir, ".venv", "bin", "python");
  }

  get ready(): boolean {
    return existsSync(this.venvPython());
  }

  /** Python installé sur le PC (py -3 sous Windows, sinon python3/python). */
  async findPython(): Promise<string | undefined> {
    if (this.python) return this.python;
    const candidates = process.platform === "win32" ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
    for (const [cmd, ...args] of candidates) {
      const r = await runProcess(cmd!, [...args, "-c", "import sys; print(sys.executable)"], { timeoutMs: 15_000 });
      if (r.code === 0 && r.stdout.trim()) {
        this.python = r.stdout.trim().split(/\r?\n/).at(-1)!;
        return this.python;
      }
    }
    return undefined;
  }

  /** Crée l'environnement du labo et installe les bibliothèques (quelques minutes la première fois). */
  async setup(extra: string[] = []): Promise<string> {
    this.installHelpers();
    if (!this.ready) {
      const python = await this.findPython();
      if (!python) return "Python n'est pas installé. Installe-le avec : winget install -e --id Python.Python.3.12 (puis relance la préparation du labo).";
      const venv = await runProcess(python, ["-m", "venv", path.join(this.dir, ".venv")], { timeoutMs: 180_000 });
      if (venv.code !== 0) return `Création de l'environnement impossible : ${venv.stderr.slice(-500)}`;
    }
    const pip = await runProcess(this.venvPython(), ["-m", "pip", "install", "--upgrade", "--disable-pip-version-check", ...LAB_PACKAGES, ...extra], { timeoutMs: 900_000 });
    return pip.code === 0 ? `Labo prêt (${[...LAB_PACKAGES, ...extra].join(", ")}).` : `Installation incomplète : ${pip.stderr.slice(-800)}`;
  }

  /** Copie la boîte à outils jarvis_labo.py dans le labo (mise à jour à chaque version). */
  installHelpers(): void {
    const source = path.join(this.assetsDir, "labo", "jarvis_labo.py");
    if (existsSync(source)) copyFileSync(source, path.join(this.dir, "jarvis_labo.py"));
  }

  async install(packages: string[]): Promise<string> {
    if (!this.ready) return this.setup(packages);
    const safe = packages.filter((p) => /^[A-Za-z0-9_.\-[\]=<>~!,]+$/.test(p));
    const r = await runProcess(this.venvPython(), ["-m", "pip", "install", "--disable-pip-version-check", ...safe], { timeoutMs: 900_000 });
    return r.code === 0 ? `Installé : ${safe.join(", ")}.` : `Échec : ${r.stderr.slice(-800)}`;
  }

  /** Exécute un script Python ; les figures matplotlib ouvertes sont enregistrées en PNG. */
  async run(code: string, timeoutMs = 120_000): Promise<RunResult> {
    this.installHelpers();
    const python = this.ready ? this.venvPython() : await this.findPython();
    if (!python) return { code: -1, stdout: "", stderr: "Python n'est pas installé (prépare d'abord le labo).", figures: [], timedOut: false };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const script = path.join(this.dir, "scripts", `${stamp}.py`);
    const figuresDir = path.join(this.dir, "figures");
    const prelude = [
      "import sys, os",
      `sys.path.insert(0, ${JSON.stringify(this.dir)})`,
      "try:",
      "    import matplotlib",
      "    matplotlib.use('Agg')",
      "except Exception:",
      "    pass",
    ].join("\n");
    const epilogue = [
      "",
      "try:",
      "    import matplotlib.pyplot as _plt",
      "    for _i, _n in enumerate(_plt.get_fignums()):",
      `        _f = os.path.join(${JSON.stringify(figuresDir)}, '${stamp}_' + str(_i + 1) + '.png')`,
      "        _plt.figure(_n).savefig(_f, dpi=130, bbox_inches='tight')",
      "        print('[figure] ' + _f)",
      "except Exception:",
      "    pass",
    ].join("\n");
    writeFileSync(script, `${prelude}\n\n${code}\n${epilogue}\n`);
    const result = await runProcess(python, [script], { cwd: this.dir, timeoutMs });
    const figures = result.stdout
      .split(/\r?\n/)
      .filter((l) => l.startsWith("[figure] "))
      .map((l) => l.slice(9).trim());
    const stdout = result.stdout
      .split(/\r?\n/)
      .filter((l) => !l.startsWith("[figure] "))
      .join("\n")
      .trim();
    return { code: result.code, stdout, stderr: result.stderr.trim(), figures, timedOut: result.timedOut };
  }

  figures(limit = 10): string[] {
    const dir = path.join(this.dir, "figures");
    return readdirSync(dir)
      .filter((n) => n.endsWith(".png"))
      .sort()
      .reverse()
      .slice(0, limit)
      .map((n) => path.join(dir, n));
  }
}

/** Cahier d'expériences d'un projet (projets/<nom>/CAHIER.md). */
export function addNotebookEntry(projectDir: string, entry: { titre: string; hypothese?: string; protocole?: string; resultats?: string; conclusion?: string }, now = new Date()): string {
  mkdirSync(projectDir, { recursive: true });
  const file = path.join(projectDir, "CAHIER.md");
  if (!existsSync(file)) writeFileSync(file, `# Cahier d'expériences — ${path.basename(projectDir)}\n`);
  const date = now.toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" });
  const block = [
    "",
    `## ${entry.titre}`,
    `*${date}*`,
    entry.hypothese ? `\n**Hypothèse** : ${entry.hypothese}` : "",
    entry.protocole ? `\n**Protocole** :\n${entry.protocole}` : "",
    entry.resultats ? `\n**Résultats** :\n${entry.resultats}` : "",
    entry.conclusion ? `\n**Conclusion** : ${entry.conclusion}` : "",
    "",
  ].filter((l) => l !== "");
  appendFileSync(file, `${block.join("\n")}\n`);
  return file;
}

export function readNotebook(projectDir: string): string | undefined {
  const file = path.join(projectDir, "CAHIER.md");
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}
