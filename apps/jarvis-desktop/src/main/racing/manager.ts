import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { debrief, lapsCsv, quickAnswer, RaceEngineer, type RadioMessage, type Verbosity } from "./engineer.js";
import { F1Source, type EventF1 } from "./f1.js";
import { LmuSource } from "./lmu.js";
import type { Game, RaceState } from "./state.js";

/**
 * Chef d'orchestre de la course : écoute F1 et Le Mans Ultimate, garde l'état
 * du jeu en cours, fait parler l'ingénieur et enregistre chaque séance.
 */

export interface RaceManagerOptions {
  workspace: string;
  name: string;
  verbosity: Verbosity;
  f1Port: number;
  /** Une annonce radio. */
  onRadio: (message: RadioMessage) => void;
  /** État à afficher (au plus deux fois par seconde). */
  onState: (state: RaceState | undefined) => void;
  /** Fin de séance : bilan et fichier des tours. */
  onSessionEnd: (summary: string, csvPath: string, state: RaceState) => void;
}

export class RaceManager {
  private readonly f1: F1Source;
  private readonly lmu: LmuSource;
  private readonly engineers: Record<Game, RaceEngineer>;
  private current: RaceState | undefined;
  private lastBroadcast = 0;
  private watchdog: NodeJS.Timeout | undefined;
  private readonly sessionLaps = new Map<string, number>();

  constructor(private readonly options: RaceManagerOptions) {
    const engineerOptions = { verbosity: options.verbosity, name: options.name };
    this.engineers = { F1: new RaceEngineer(engineerOptions), LMU: new RaceEngineer(engineerOptions) };
    this.f1 = new F1Source(options.f1Port, (state, event) => this.update(state, event));
    this.lmu = new LmuSource((state) => this.update(state));
  }

  get lmuApi(): LmuSource {
    return this.lmu;
  }

  /** Une séance est en cours (le jeu envoie des données depuis moins de 5 secondes). */
  get active(): boolean {
    return Boolean(this.current?.actif && Date.now() - this.current.miseAJour < 5_000);
  }

  get state(): RaceState | undefined {
    return this.current;
  }

  start(): void {
    this.f1.start();
    this.lmu.start();
    // Le jeu a cessé d'envoyer des données (menu, jeu fermé) : la séance est terminée.
    this.watchdog = setInterval(() => {
      if (this.current?.actif && Date.now() - this.current.miseAJour > 15_000) this.end(this.current);
    }, 5_000);
  }

  stop(): void {
    if (this.current?.actif) this.end(this.current);
    this.f1.stop();
    this.lmu.stop();
    if (this.watchdog) clearInterval(this.watchdog);
  }

  answer(question: string): string | undefined {
    return this.current && this.active ? quickAnswer(question, this.current) : undefined;
  }

  private key(state: RaceState): string {
    return `${state.jeu}|${state.piste ?? ""}|${state.session ?? ""}`;
  }

  private update(state: RaceState, event?: EventF1): void {
    const previous = this.current;
    if (previous && previous !== state && previous.actif && this.key(previous) !== this.key(state)) this.end(previous);
    if (!state.actif) {
      if (previous === state && this.sessionLaps.has(this.key(state))) this.end(state);
      this.broadcast(state, true);
      return;
    }
    this.current = state;
    this.sessionLaps.set(this.key(state), state.tours.length);
    for (const message of this.engineers[state.jeu].update(state, event)) this.options.onRadio(message);
    this.broadcast(state);
  }

  private trailing: NodeJS.Timeout | undefined;

  /** Au plus deux affichages par seconde, mais toujours le dernier état à la fin. */
  private broadcast(state: RaceState, force = false): void {
    const now = Date.now();
    const wait = 500 - (now - this.lastBroadcast);
    if (!force && wait > 0) {
      if (!this.trailing) {
        this.trailing = setTimeout(() => {
          this.trailing = undefined;
          this.broadcast(this.current ?? state, true);
        }, wait);
      }
      return;
    }
    this.lastBroadcast = now;
    this.options.onState(state.actif ? state : undefined);
  }

  /** Bilan de séance, une seule fois par séance, et seulement si au moins un tour a été bouclé. */
  private end(state: RaceState): void {
    const key = this.key(state);
    if (!this.sessionLaps.has(key)) return;
    this.sessionLaps.delete(key);
    if (this.current === state) this.current = undefined;
    if (state.tours.length === 0) return;
    const dir = path.join(this.options.workspace, "simu", state.jeu === "F1" ? "F1" : "Le Mans Ultimate");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const file = path.join(dir, `${stamp}_${(state.piste ?? "piste").replace(/[^\p{L}\p{N}]+/gu, "-")}_${(state.session ?? "seance").replace(/[^\p{L}\p{N}]+/gu, "-")}.csv`);
    writeFileSync(file, `﻿${lapsCsv(state)}`);
    this.options.onSessionEnd(debrief(state), file, state);
  }
}
