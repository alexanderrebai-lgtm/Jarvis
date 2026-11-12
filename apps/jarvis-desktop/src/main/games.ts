import { execFile } from "node:child_process";

/**
 * Détecte qu'un jeu de course tourne (processus Windows), pour réserver
 * l'écran du milieu au jeu et ne plus voler le premier plan.
 */

export const DEFAULT_GAME_PROCESSES = ["Le Mans Ultimate.exe", "LMU.exe", "F1_25.exe", "F1_24.exe", "F1_2026.exe", "F1_26.exe"];

/** Lit la sortie de « tasklist /fo csv /nh » et renvoie les jeux trouvés. */
export function findGames(tasklistCsv: string, names: string[]): string[] {
  const wanted = new Map(names.map((n) => [n.toLowerCase(), n]));
  const found = new Set<string>();
  for (const line of tasklistCsv.split(/\r?\n/)) {
    const first = line.match(/^"([^"]+)"/)?.[1]?.toLowerCase();
    if (first && wanted.has(first)) found.add(wanted.get(first)!);
  }
  return [...found];
}

export class GameWatcher {
  private timer: NodeJS.Timeout | undefined;
  private running: string[] = [];

  constructor(
    private readonly options: {
      processes: string[];
      onChange: (running: string[]) => void;
      /** Pour les tests : renvoie la liste des processus. */
      list?: () => Promise<string>;
      intervalMs?: number;
    },
  ) {}

  get active(): boolean {
    return this.running.length > 0;
  }

  get games(): string[] {
    return this.running;
  }

  start(): void {
    if (process.platform !== "win32" && !this.options.list) return;
    const tick = async () => {
      try {
        const csv = await (this.options.list ?? listProcesses)();
        const next = findGames(csv, this.options.processes);
        if (next.join("|") !== this.running.join("|")) {
          this.running = next;
          this.options.onChange(next);
        }
      } catch {
        // tasklist indisponible un instant : on réessaiera.
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), this.options.intervalMs ?? 10_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

function listProcesses(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("tasklist", ["/fo", "csv", "/nh"], { windowsHide: true, timeout: 8_000, maxBuffer: 4_000_000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}
