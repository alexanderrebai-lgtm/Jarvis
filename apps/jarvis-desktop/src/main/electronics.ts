import { runProcess } from "./lab.js";

/**
 * Électronique : Arduino et ESP32 avec arduino-cli (compiler, téléverser,
 * bibliothèques), cartes branchées détectées automatiquement, moniteur série.
 * Les calculs (résistances, diviseurs, autonomie, sections de câble) sont dans
 * la boîte à outils du labo, et les schémas se dessinent avec schemdraw.
 */

export interface Board {
  port: string;
  nom?: string;
  fqbn?: string;
  protocole?: string;
}

/** Sortie JSON de « arduino-cli board list --format json » (formats ancien et récent). */
export function parseBoardList(json: string): Board[] {
  const data = JSON.parse(json) as unknown;
  const entries = Array.isArray(data) ? data : ((data as { detected_ports?: unknown[] }).detected_ports ?? []);
  return (entries as Array<Record<string, unknown>>).map((e) => {
    const port = (e.port ?? e) as { address?: string; protocol?: string };
    const boards = (e.matching_boards ?? e.boards ?? []) as Array<{ name?: string; fqbn?: string }>;
    return { port: String(port.address ?? ""), ...(boards[0]?.name ? { nom: boards[0].name } : {}), ...(boards[0]?.fqbn ? { fqbn: boards[0].fqbn } : {}), ...(port.protocol ? { protocole: port.protocol } : {}) };
  }).filter((b) => b.port);
}

export class Microcontrollers {
  private cli: string | undefined;

  constructor(private readonly cliPath?: string) {}

  async find(): Promise<string | undefined> {
    if (this.cli) return this.cli;
    for (const candidate of [this.cliPath, "arduino-cli", process.platform === "win32" ? "C:\\Program Files\\Arduino CLI\\arduino-cli.exe" : undefined].filter((x): x is string => Boolean(x))) {
      const r = await runProcess(candidate, ["version"], { timeoutMs: 10_000 });
      if (r.code === 0) {
        this.cli = candidate;
        return candidate;
      }
    }
    return undefined;
  }

  private async run(args: string[], timeoutMs = 300_000, cwd?: string): Promise<{ ok: boolean; text: string }> {
    const cli = await this.find();
    if (!cli) return { ok: false, text: "arduino-cli n'est pas installé. Installe-le avec : winget install -e --id ArduinoSA.CLI, puis « arduino-cli core update-index »." };
    const r = await runProcess(cli, args, { timeoutMs, ...(cwd ? { cwd } : {}) });
    const text = `${r.stdout}\n${r.stderr}`.trim().slice(-6000);
    return { ok: r.code === 0, text: r.timedOut ? `${text}\n(délai dépassé)` : text };
  }

  async boards(): Promise<Board[] | string> {
    const r = await this.run(["board", "list", "--format", "json"], 30_000);
    if (!r.ok) return r.text;
    try {
      return parseBoardList(r.text.slice(r.text.indexOf(r.text.trim().startsWith("[") ? "[" : "{")));
    } catch {
      return r.text;
    }
  }

  async installCore(core: string): Promise<string> {
    await this.run(["core", "update-index"], 180_000);
    return (await this.run(["core", "install", core], 900_000)).text;
  }

  async installLibrary(name: string): Promise<string> {
    return (await this.run(["lib", "install", name], 300_000)).text;
  }

  async compile(sketchDir: string, fqbn: string): Promise<{ ok: boolean; text: string }> {
    return this.run(["compile", "--fqbn", fqbn, sketchDir], 600_000);
  }

  async upload(sketchDir: string, fqbn: string, port: string): Promise<{ ok: boolean; text: string }> {
    return this.run(["compile", "--upload", "--fqbn", fqbn, "--port", port, sketchDir], 600_000);
  }
}
