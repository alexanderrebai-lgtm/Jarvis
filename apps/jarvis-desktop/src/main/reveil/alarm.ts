import { JsonStore } from "@muscu/jarvis/src/store.js";
import type { Shift } from "./planning.js";
import { addDays, nextAlarm, sayTime, zonedParts, type AlarmOverride, type AlarmRules, type NextAlarm } from "./schedule.js";

/**
 * Le réveil de Jarvis. Dix minutes avant, les ampoules imitent un lever de
 * soleil ; à l'heure, l'écran se rallume et la playlist démarre (volume qui
 * monte doucement, sonnerie intégrée si Spotify ne répond pas). Quand Alex dit
 * « je suis debout », la musique baisse et Jarvis prononce son message du matin.
 */

export type WakePhase = "attente" | "aube" | "sonne" | "repousse" | "reveille";

export interface WakeStatus {
  phase: WakePhase;
  prochain?: { date: string; heure: string; raison: string; instant: string } | undefined;
  sonneDepuis?: string | undefined;
  musique?: "spotify" | "sonnerie" | undefined;
}

export interface WakeDeps {
  dataDir: string;
  timeZone: string;
  ownerName: string;
  rules: () => AlarmRules;
  shifts: () => Promise<Shift[]>;
  music?: {
    /** Lance la playlist du réveil ; faux si Spotify n'a pas pu démarrer. */
    start: () => Promise<boolean>;
    volume: (pct: number) => Promise<void>;
    stop: () => Promise<void>;
  };
  /** Lever de soleil : 0 (aube) → 1 (plein jour). */
  lights?: (level: number) => Promise<void>;
  /** Message du matin (sans l'heure, ajoutée au moment de le dire). */
  prepareGreeting: (context: { date: string; shift?: Shift | undefined }) => Promise<string>;
  say: (text: string) => void;
  /** Sonnerie intégrée (si la musique ne démarre pas). */
  ring: (on: boolean) => void;
  wakeScreen: () => void;
  /** Programme la sortie de veille de Windows avant le réveil. */
  scheduleSystemWake?: (at: Date) => Promise<void>;
  notify: (title: string, body: string) => void;
  onChange?: (status: WakeStatus) => void;
  /** Que faire de la musique après le message : la laisser (bas) ou la couper. */
  musicAfter?: () => "continuer" | "pause";
  now?: () => Date;
}

interface WakeState {
  fired: string[];
  overrides: AlarmOverride[];
}

const SUNRISE_MIN = 10;
const PREPARE_MIN = 4;

export class WakeUp {
  private readonly state: JsonStore<WakeState>;
  private timer: NodeJS.Timeout | undefined;
  private phase: WakePhase = "attente";
  private next: NextAlarm | undefined;
  private nextComputedAt = 0;
  private ringingSince: number | undefined;
  private snoozeUntil: number | undefined;
  private greeting: Promise<string> | undefined;
  private musicMode: "spotify" | "sonnerie" | undefined;
  private volume = 20;
  private lastNag = 0;
  private lastLight = -1;
  private scheduledWake: string | undefined;
  private busy = false;

  constructor(private readonly deps: WakeDeps) {
    this.state = new JsonStore(deps.dataDir, "reveil", () => ({ fired: [], overrides: [] }));
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  start(intervalMs = 15_000): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  status(): WakeStatus {
    return {
      phase: this.phase,
      prochain: this.next ? { date: this.next.date, heure: this.next.heure, raison: this.next.raison, instant: this.next.at.toISOString() } : undefined,
      sonneDepuis: this.ringingSince ? new Date(this.ringingSince).toISOString() : undefined,
      musique: this.musicMode,
    };
  }

  get ringing(): boolean {
    return this.phase === "sonne" || this.phase === "repousse";
  }

  /** Recalcule le prochain réveil (planning modifié, réglage changé). */
  async refresh(): Promise<NextAlarm | undefined> {
    const s = this.state.read();
    const shifts = await this.deps.shifts().catch(() => []);
    this.next = nextAlarm(this.now(), this.deps.timeZone, shifts, this.deps.rules(), s.overrides, s.fired);
    this.nextComputedAt = this.now().getTime();
    if (this.next && this.deps.scheduleSystemWake) {
      const key = this.next.at.toISOString();
      if (key !== this.scheduledWake) {
        this.scheduledWake = key;
        await this.deps.scheduleSystemWake(new Date(this.next.at.getTime() - 6 * 60_000)).catch((error) => console.warn("[réveil] sortie de veille non programmée", error));
      }
    }
    this.emit();
    return this.next;
  }

  /** Règle un réveil pour un jour (« demain à 6 h 30 ») ou le supprime (aucun). */
  async setOverride(override: AlarmOverride): Promise<NextAlarm | undefined> {
    this.state.update((s) => ({ ...s, overrides: [...s.overrides.filter((o) => o.date !== override.date), override].filter((o) => o.date >= addDays(this.today(), -2)) }));
    return this.refresh();
  }

  async clearOverride(date: string): Promise<NextAlarm | undefined> {
    this.state.update((s) => ({ ...s, overrides: s.overrides.filter((o) => o.date !== date) }));
    return this.refresh();
  }

  overrides(): AlarmOverride[] {
    return this.state.read().overrides;
  }

  today(): string {
    return zonedParts(this.now(), this.deps.timeZone).date;
  }

  tomorrow(): string {
    return addDays(this.today(), 1);
  }

  private emit(): void {
    this.deps.onChange?.(this.status());
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.step();
    } finally {
      this.busy = false;
    }
  }

  private async step(): Promise<void> {
    const now = this.now().getTime();
    if (this.phase === "repousse") {
      if (this.snoozeUntil !== undefined && now >= this.snoozeUntil) await this.fire(true);
      return;
    }
    if (this.phase === "sonne") {
      await this.whileRinging(now);
      return;
    }
    if (!this.next || now - this.nextComputedAt > 10 * 60_000 || this.phase === "reveille") {
      if (this.phase === "reveille") this.phase = "attente";
      await this.refresh();
    }
    const next = this.next;
    if (!next) return;
    const at = next.at.getTime();
    const sunriseStart = at - SUNRISE_MIN * 60_000;
    if (now >= sunriseStart && now < at) {
      if (this.phase !== "aube") {
        this.phase = "aube";
        this.emit();
      }
      const level = Math.min(1, Math.max(0, (now - sunriseStart) / (SUNRISE_MIN * 60_000)));
      if (this.deps.lights && level - this.lastLight >= 0.08) {
        this.lastLight = level;
        await this.deps.lights(level).catch(() => undefined);
      }
      if (now >= at - PREPARE_MIN * 60_000 && !this.greeting) this.prepare(next);
      return;
    }
    if (now >= at && now < at + 30 * 60_000) await this.fire(false);
  }

  private prepare(next: NextAlarm): void {
    this.greeting = this.deps.prepareGreeting({ date: next.date, shift: next.shift }).catch(() => "");
  }

  private async fire(afterSnooze: boolean): Promise<void> {
    const next = this.next;
    if (!afterSnooze && next) this.state.update((s) => ({ ...s, fired: [...s.fired.filter((d) => d >= addDays(next.date, -14)), next.date] }));
    if (!this.greeting && next) this.prepare(next);
    this.phase = "sonne";
    this.ringingSince = this.ringingSince && afterSnooze ? this.ringingSince : this.now().getTime();
    this.lastNag = this.now().getTime();
    this.snoozeUntil = undefined;
    this.deps.wakeScreen();
    if (this.deps.lights) await this.deps.lights(1).catch(() => undefined);
    this.volume = 18;
    let started = false;
    if (this.deps.music) {
      started = await Promise.race([this.deps.music.start().catch(() => false), new Promise<boolean>((r) => setTimeout(() => r(false), 25_000))]);
      if (started) await this.deps.music.volume(this.volume).catch(() => undefined);
    }
    this.musicMode = started ? "spotify" : "sonnerie";
    if (!started) this.deps.ring(true);
    this.emit();
  }

  private async whileRinging(now: number): Promise<void> {
    const since = this.ringingSince ?? now;
    // Le volume monte d'un cran par tour, jusqu'à 70 %.
    if (this.musicMode === "spotify" && this.volume < 70) {
      this.volume = Math.min(70, this.volume + 4);
      await this.deps.music?.volume(this.volume).catch(() => undefined);
    }
    if (now - since >= 30 * 60_000) {
      // Personne ne répond : on arrête tout et on le note.
      await this.silence();
      this.phase = "attente";
      this.ringingSince = undefined;
      this.greeting = undefined;
      this.deps.notify("Réveil", `${this.deps.ownerName} ne s'est pas manifesté : réveil arrêté au bout de 30 minutes.`);
      this.emit();
      return;
    }
    if (now - this.lastNag >= 5 * 60_000) {
      this.lastNag = now;
      const heure = zonedParts(new Date(now), this.deps.timeZone).heure;
      const lines = [
        `${this.deps.ownerName}, il est ${sayTime(heure)}. Le monde ne va pas se sauver tout seul.`,
        `${this.deps.ownerName}, il est ${sayTime(heure)}. Je me permets d'insister.`,
        `Il est ${sayTime(heure)}, ${this.deps.ownerName}. Dis-moi « je suis debout » et je baisse la musique.`,
      ];
      this.deps.say(lines[Math.floor((now - since) / (5 * 60_000)) % lines.length]!);
    }
  }

  private async silence(): Promise<void> {
    this.deps.ring(false);
    if (this.musicMode === "spotify") await this.deps.music?.stop().catch(() => undefined);
    this.musicMode = undefined;
  }

  /** « Je suis debout » : la musique baisse et Jarvis dit son message du matin. */
  async confirmAwake(): Promise<boolean> {
    if (!this.ringing) return false;
    this.deps.ring(false);
    if (this.musicMode === "spotify") await this.deps.music?.volume(12).catch(() => undefined);
    this.phase = "reveille";
    this.ringingSince = undefined;
    this.emit();
    const greeting = await Promise.race([this.greeting ?? Promise.resolve(""), new Promise<string>((r) => setTimeout(() => r(""), 25_000))]);
    this.greeting = undefined;
    const heure = zonedParts(this.now(), this.deps.timeZone).heure;
    const text = `Bonjour ${this.deps.ownerName}. Il est ${sayTime(heure)}. ${greeting || "Je n'ai pas réussi à préparer mon point du matin, mais je suis tout ouïe."}`;
    this.deps.say(text);
    if (this.musicMode === "spotify") {
      if ((this.deps.musicAfter?.() ?? "continuer") === "pause") {
        const ms = Math.min(90_000, 3_000 + text.length * 70);
        setTimeout(() => void this.deps.music?.stop().catch(() => undefined), ms);
      } else setTimeout(() => void this.deps.music?.volume(25).catch(() => undefined), Math.min(90_000, 3_000 + text.length * 70));
    }
    this.musicMode = undefined;
    return true;
  }

  /** « Encore cinq minutes » : on coupe et on recommence plus tard. */
  async snooze(minutes = 9): Promise<boolean> {
    if (!this.ringing) return false;
    await this.silence();
    this.phase = "repousse";
    this.snoozeUntil = this.now().getTime() + minutes * 60_000;
    this.emit();
    return true;
  }

  /** Arrête un réveil qui sonne (sans message du matin). */
  async dismiss(): Promise<boolean> {
    if (!this.ringing) return false;
    await this.silence();
    this.phase = "attente";
    this.ringingSince = undefined;
    this.greeting = undefined;
    this.emit();
    return true;
  }

  /** Lance le réveil maintenant (pour l'essayer). */
  async test(): Promise<void> {
    await this.refresh();
    const date = this.today();
    this.next = { at: this.now(), date, heure: zonedParts(this.now(), this.deps.timeZone).heure, raison: "essai" };
    this.prepare(this.next);
    await this.fire(true);
  }
}

/** Script PowerShell : tâche planifiée qui sort le PC de veille juste avant le réveil. */
export function wakeTaskScript(at: Date, taskName = "Jarvis - sortie de veille"): string {
  const local = new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  return [
    `$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c exit"`,
    `$trigger = New-ScheduledTaskTrigger -Once -At ([datetime]::Parse('${local}'))`,
    `$settings = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable`,
    `Register-ScheduledTask -TaskName '${taskName.replace(/'/g, "''")}' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null`,
    `Write-Output 'ok'`,
  ].join("\n");
}
