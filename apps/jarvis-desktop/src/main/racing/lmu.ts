import { emptyState, type Flag, type RaceState } from "./state.js";

/**
 * Le Mans Ultimate : le jeu publie une API web locale (http://127.0.0.1:6397),
 * activée par défaut. On y lit le classement, la séance et l'état de la voiture.
 * Les noms de champs ne sont pas documentés officiellement : la lecture est
 * tolérante (plusieurs noms possibles, valeurs absentes ignorées).
 */

export const LMU_BASE = "http://127.0.0.1:6397";

type Json = Record<string, unknown>;

function num(obj: Json | undefined, ...keys: string[]): number | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function str(obj: Json | undefined, ...keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

const positive = (v: number | undefined) => (v !== undefined && v > 0 ? v : undefined);

export interface LmuSnapshot {
  standings?: unknown;
  sessionInfo?: unknown;
  vehicle?: unknown;
}

export interface LmuLapEvent {
  lap: number;
  timeS: number;
}

/** Transforme les réponses de l'API en état de course. Fonction pure, testable sans le jeu. */
export class LmuMapper {
  state: RaceState = emptyState("LMU");
  private lastLaps: number | undefined;
  private lastLapTime: number | undefined;
  private sessionKey: string | undefined;

  constructor(private readonly now: () => number = Date.now) {}

  apply(snapshot: LmuSnapshot): LmuLapEvent | undefined {
    const info = (snapshot.sessionInfo ?? undefined) as Json | undefined;
    const list = Array.isArray(snapshot.standings) ? (snapshot.standings as Json[]) : [];
    const me = list.find((car) => car.player === true || car.isPlayer === true);
    if (!me) {
      this.state.actif = false;
      return undefined;
    }

    const session = str(info, "session", "sessionName") ?? "";
    const key = `${session}|${str(info, "trackName", "track") ?? ""}`;
    if (key !== this.sessionKey) {
      this.sessionKey = key;
      this.state = emptyState("LMU");
      this.lastLaps = undefined;
      this.lastLapTime = undefined;
    }
    const s = this.state;
    s.actif = true;
    s.miseAJour = this.now();
    s.session = sessionLabel(session);
    s.enCourse = /race/i.test(session);
    s.piste = str(info, "trackName", "track") ?? s.piste;
    s.totalTours = positive(num(info, "maximumLaps", "maxLaps")) && num(info, "maximumLaps", "maxLaps")! < 10_000 ? num(info, "maximumLaps", "maxLaps") : undefined;
    s.tempsRestantS = positive(num(info, "timeRemainingInGamePhase", "timeRemaining"));
    s.meteo = { ...(num(info, "trackTemp") !== undefined ? { pisteC: num(info, "trackTemp")! } : {}), ...(num(info, "ambientTemp") !== undefined ? { airC: num(info, "ambientTemp")! } : {}) };

    // Classement dans la catégorie du joueur (Hypercar, LMP2, LMGT3…).
    const classe = str(me, "carClass", "vehicleClass");
    s.classe = classe;
    const sameClass = list.filter((car) => !classe || str(car, "carClass", "vehicleClass") === classe);
    const order = (car: Json) => num(car, "position", "place", "classPosition") ?? 999;
    const ranked = [...sameClass].sort((a, b) => order(a) - order(b));
    const index = ranked.indexOf(me);
    s.position = index + 1;
    s.nbVoitures = ranked.length;
    const gapTo = (other: Json | undefined) => {
      if (!other) return undefined;
      const a = num(me, "timeBehindLeader");
      const b = num(other, "timeBehindLeader");
      const lapsA = num(me, "lapsBehindLeader") ?? 0;
      const lapsB = num(other, "lapsBehindLeader") ?? 0;
      return a !== undefined && b !== undefined && lapsA === lapsB ? Math.abs(a - b) : undefined;
    };
    const ahead = ranked[index - 1];
    const behind = ranked[index + 1];
    s.ecartDevantS = gapTo(ahead);
    s.ecartDerriereS = gapTo(behind);
    s.pilotes = { ...(ahead && str(ahead, "driverName") ? { devant: str(ahead, "driverName")! } : {}), ...(behind && str(behind, "driverName") ? { derriere: str(behind, "driverName")! } : {}) };

    s.dernierTourS = positive(num(me, "lastLapTime"));
    const best = positive(num(me, "bestLapTime"));
    if (best !== undefined) s.meilleurTourS = best;
    s.stand = { ...s.stand, arrets: num(me, "pitstops", "numPitstops") ?? s.stand?.arrets ?? 0, dansLaVoie: /pit|request|stopped|entering|exiting/i.test(str(me, "pitState") ?? "") && !/none/i.test(str(me, "pitState") ?? "") };
    s.penalitesS = num(me, "penalties");
    s.drapeau = flagOf(me, info);

    const vehicle = (snapshot.vehicle ?? undefined) as Json | undefined;
    const capacity = num(vehicle, "fuelCapacity");
    const fuel = num(vehicle, "fuel") ?? (num(me, "fuelFraction") !== undefined && capacity ? num(me, "fuelFraction")! * capacity : undefined);
    if (fuel !== undefined) s.carburant = { ...s.carburant, unite: "L", restant: Math.round(fuel * 10) / 10, ...(capacity ? { capacite: capacity } : {}) };
    const ve = num(me, "veFraction");
    if (ve !== undefined && ve >= 0) s.energie = { ...s.energie, fraction: Math.round(ve * 1000) / 1000 };
    const tyres = vehicle?.tireCondition;
    if (Array.isArray(tyres) && tyres.length === 4 && tyres.every((t) => typeof t === "number")) {
      // État restant (1 = neuf) → usure en %.
      s.pneus = { ...s.pneus, usure: (tyres as number[]).map((t) => Math.round((1 - t) * 1000) / 10) };
    }

    // Tour bouclé ?
    const laps = num(me, "lapsCompleted", "totalLaps", "laps");
    const lapTime = s.dernierTourS;
    let completed: LmuLapEvent | undefined;
    const lapChanged = laps !== undefined ? this.lastLaps !== undefined && laps > this.lastLaps : this.lastLapTime !== undefined && lapTime !== this.lastLapTime;
    if (lapChanged && lapTime !== undefined) {
      const numero = laps ?? (s.tours.at(-1)?.numero ?? 0) + 1;
      s.tours.push({ numero, tempsS: lapTime, valide: true, position: s.position, ...(s.carburant?.restant !== undefined ? { carburant: s.carburant.restant } : {}), ...(s.energie ? { energie: s.energie.fraction } : {}) });
      completed = { lap: numero, timeS: lapTime };
      this.consumption();
    }
    if (laps !== undefined) {
      this.lastLaps = laps;
      s.tour = laps + 1;
    }
    this.lastLapTime = lapTime;
    return completed;
  }

  /** Consommation moyenne sur les derniers tours, et autonomie. */
  private consumption(): void {
    const s = this.state;
    const recent = s.tours.slice(-4);
    if (recent.length < 2) return;
    const span = recent.length - 1;
    const first = recent[0]!;
    const last = recent.at(-1)!;
    if (s.carburant && first.carburant !== undefined && last.carburant !== undefined) {
      const perLap = (first.carburant - last.carburant) / span;
      if (perLap > 0) {
        s.carburant.parTour = Math.round(perLap * 100) / 100;
        if (s.carburant.restant !== undefined) s.carburant.toursRestants = Math.round((s.carburant.restant / perLap) * 10) / 10;
      }
    }
    if (s.energie && first.energie !== undefined && last.energie !== undefined) {
      const perLap = (first.energie - last.energie) / span;
      if (perLap > 0) {
        s.energie.parTour = Math.round(perLap * 1000) / 1000;
        s.energie.toursRestants = Math.round((s.energie.fraction / perLap) * 10) / 10;
      }
    }
  }
}

function sessionLabel(session: string): string {
  if (/race/i.test(session)) return "Course";
  if (/qual/i.test(session)) return "Qualification";
  if (/warm/i.test(session)) return "Warm-up";
  if (/prac/i.test(session)) return "Essais";
  return session || "Séance";
}

function flagOf(me: Json, info: Json | undefined): Flag {
  const flag = str(me, "flag")?.toLowerCase() ?? "";
  const yellow = str(info, "yellowFlagState")?.toLowerCase() ?? "";
  const phase = str(info, "gamePhase")?.toLowerCase() ?? String(num(info, "gamePhase") ?? "");
  if (/full|safety|pace/.test(yellow) || /fullcourse|safety/.test(phase)) return "safety_car";
  if (/red/.test(phase)) return "rouge";
  if (/checkered|chequered|over/.test(phase)) return "damier";
  if (/blue/.test(flag)) return "bleu";
  if (me.underYellow === true) return "jaune";
  return "vert";
}

/** Interroge l'API du jeu quand il tourne ; se met en veille sinon. */
export class LmuSource {
  readonly mapper = new LmuMapper();
  private timer: NodeJS.Timeout | undefined;
  private vehicle: unknown;
  private lastVehicleAt = 0;
  private idleUntil = 0;

  constructor(private readonly onUpdate: (state: RaceState, lap?: LmuLapEvent) => void, private readonly base = LMU_BASE) {}

  start(): void {
    const tick = async () => {
      if (Date.now() < this.idleUntil) return;
      try {
        const [standings, sessionInfo] = await Promise.all([this.get("/rest/watch/standings"), this.get("/rest/watch/sessionInfo")]);
        if (Date.now() - this.lastVehicleAt > 5_000) {
          this.lastVehicleAt = Date.now();
          this.vehicle = await this.get("/rest/garage/getVehicleCondition").catch(() => this.vehicle);
        }
        const lap = this.mapper.apply({ standings, sessionInfo, vehicle: this.vehicle });
        this.onUpdate(this.mapper.state, lap);
      } catch {
        // Jeu fermé : on réessaie dans 10 secondes.
        if (this.mapper.state.actif) {
          this.mapper.state.actif = false;
          this.onUpdate(this.mapper.state);
        }
        this.idleUntil = Date.now() + 10_000;
      }
    };
    this.timer = setInterval(() => void tick(), 500);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Lecture d'un chemin de l'API (utilisé aussi par Jarvis pour explorer ce que le jeu expose). */
  async get(pathname: string): Promise<unknown> {
    if (!/^\/rest\/[\w/.-]*$/.test(pathname)) throw new Error("Chemin refusé : seules les adresses /rest/… du jeu sont lisibles.");
    const response = await fetch(`${this.base}${pathname}`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error(`LMU a répondu ${response.status}`);
    return response.json();
  }
}
