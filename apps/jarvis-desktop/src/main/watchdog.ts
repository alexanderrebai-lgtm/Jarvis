import type { CheckResult } from "./diagnostic.js";

/**
 * Veilleur des connexions : toutes les 15 minutes, Jarvis repasse le diagnostic
 * sur les éléments importants. Quand l'un d'eux décroche (deux contrôles de
 * suite, pour éviter les fausses alertes), il prévient une seule fois ; quand
 * il revient, il le dit aussi.
 */

export interface WatchdogOptions {
  run: () => Promise<CheckResult[]>;
  /** Éléments surveillés (identifiants du diagnostic). */
  watched: string[];
  onLost: (results: CheckResult[]) => void;
  onBack: (results: CheckResult[]) => void;
  intervalMs?: number;
  firstDelayMs?: number;
  /** Contrôles en échec de suite avant d'alerter. */
  confirmations?: number;
}

const BAD = new Set(["erreur", "attention"]);

export class Watchdog {
  private timer: NodeJS.Timeout | undefined;
  private readonly failures = new Map<string, number>();
  /** Éléments signalés comme déconnectés (pas encore revenus). */
  readonly down = new Set<string>();

  constructor(private readonly options: WatchdogOptions) {}

  start(): void {
    const tick = () => void this.check().catch((error) => console.warn("[veilleur]", error));
    this.timer = setTimeout(() => {
      tick();
      this.timer = setInterval(tick, this.options.intervalMs ?? 15 * 60_000);
    }, this.options.firstDelayMs ?? 5 * 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Un passage : renvoie ce qui vient de décrocher et ce qui vient de revenir. */
  async check(): Promise<{ perdus: CheckResult[]; revenus: CheckResult[] }> {
    const results = (await this.options.run()).filter((r) => this.options.watched.includes(r.id));
    const lost: CheckResult[] = [];
    const back: CheckResult[] = [];
    for (const r of results) {
      if (BAD.has(r.etat)) {
        const count = (this.failures.get(r.id) ?? 0) + 1;
        this.failures.set(r.id, count);
        if (count >= (this.options.confirmations ?? 2) && !this.down.has(r.id)) {
          this.down.add(r.id);
          lost.push(r);
        }
      } else {
        this.failures.delete(r.id);
        // « absent » = pas configuré : ce n'est ni une panne ni un retour.
        if (r.etat === "ok" && this.down.delete(r.id)) back.push(r);
      }
    }
    if (lost.length) this.options.onLost(lost);
    if (back.length) this.options.onBack(back);
    return { perdus: lost, revenus: back };
  }
}

/** Message court pour la notification et Telegram. */
export function describeLost(results: CheckResult[]): string {
  return results.map((r) => `• ${r.titre} : ${r.detail}${r.conseil ? ` → ${r.conseil}` : ""}`).join("\n");
}
