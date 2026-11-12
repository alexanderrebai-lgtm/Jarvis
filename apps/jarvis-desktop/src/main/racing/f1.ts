import { createSocket, type Socket } from "node:dgram";
import { emptyState, type Flag, type RaceState } from "./state.js";

/**
 * Télémétrie UDP des jeux EA SPORTS F1 (F1 25, saison 2026 incluse).
 * Format : little-endian, structures « packed ». Les tailles par voiture sont
 * déduites de la longueur du paquet, ce qui rend le décodage tolérant aux
 * petits ajouts entre versions ; seuls les champs en tête de structure sont lus.
 * Référence : spécification « Data Output from F1 25 » d'EA et le dépôt
 * MacManley/f1-25-udp (licence MIT).
 */

export const HEADER_SIZE = 29;

export interface F1Header {
  packetFormat: number;
  gameYear: number;
  packetId: number;
  sessionUID: bigint;
  sessionTime: number;
  frame: number;
  playerCarIndex: number;
}

export function readHeader(buf: Buffer): F1Header | undefined {
  if (buf.length < HEADER_SIZE) return undefined;
  const packetFormat = buf.readUInt16LE(0);
  if (packetFormat < 2023 || packetFormat > 2030) return undefined;
  return {
    packetFormat,
    gameYear: buf.readUInt8(2),
    packetId: buf.readUInt8(6),
    sessionUID: buf.readBigUInt64LE(7),
    sessionTime: buf.readFloatLE(15),
    frame: buf.readUInt32LE(19),
    playerCarIndex: buf.readUInt8(27),
  };
}

export function carCount(header: F1Header): number {
  return header.packetFormat >= 2026 ? 24 : 22;
}

/** Début et taille de la structure de la voiture `index`, d'après la longueur du paquet. */
function carSlice(buf: Buffer, header: F1Header, index: number, prefix: number, trailer: number): { offset: number; stride: number } | undefined {
  const cars = carCount(header);
  const stride = Math.floor((buf.length - HEADER_SIZE - prefix - trailer) / cars);
  if (stride <= 0 || index >= cars) return undefined;
  return { offset: HEADER_SIZE + prefix + index * stride, stride };
}

export interface LapDataF1 {
  lastLapMs: number;
  currentLapMs: number;
  deltaFrontMs: number;
  deltaLeaderMs: number;
  lapDistance: number;
  position: number;
  lap: number;
  pitStatus: number;
  pitStops: number;
  sector: number;
  lapInvalid: boolean;
  penaltiesS: number;
  warnings: number;
  resultStatus: number;
}

export function readLapData(buf: Buffer, header: F1Header, index: number): LapDataF1 | undefined {
  const slice = carSlice(buf, header, index, 0, 2);
  if (!slice || slice.stride < 46) return undefined;
  const o = slice.offset;
  return {
    lastLapMs: buf.readUInt32LE(o),
    currentLapMs: buf.readUInt32LE(o + 4),
    deltaFrontMs: buf.readUInt16LE(o + 14) + buf.readUInt8(o + 16) * 60_000,
    deltaLeaderMs: buf.readUInt16LE(o + 17) + buf.readUInt8(o + 19) * 60_000,
    lapDistance: buf.readFloatLE(o + 20),
    position: buf.readUInt8(o + 32),
    lap: buf.readUInt8(o + 33),
    pitStatus: buf.readUInt8(o + 34),
    pitStops: buf.readUInt8(o + 35),
    sector: buf.readUInt8(o + 36),
    lapInvalid: buf.readUInt8(o + 37) === 1,
    penaltiesS: buf.readUInt8(o + 38),
    warnings: buf.readUInt8(o + 39),
    resultStatus: buf.readUInt8(o + 45),
  };
}

export interface TelemetryF1 {
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  rpm: number;
  brakesTemp: number[];
  tyresSurface: number[];
  tyresInner: number[];
}

export function readTelemetry(buf: Buffer, header: F1Header, index: number): TelemetryF1 | undefined {
  const slice = carSlice(buf, header, index, 0, 3);
  if (!slice || slice.stride < 38) return undefined;
  const o = slice.offset;
  const range = (start: number, n: number, read: (p: number) => number) => Array.from({ length: n }, (_, i) => read(start + i));
  return {
    speed: buf.readUInt16LE(o),
    throttle: buf.readFloatLE(o + 2),
    brake: buf.readFloatLE(o + 10),
    gear: buf.readInt8(o + 15),
    rpm: buf.readUInt16LE(o + 16),
    brakesTemp: range(0, 4, (i) => buf.readUInt16LE(o + 22 + i * 2)),
    tyresSurface: range(0, 4, (i) => buf.readUInt8(o + 30 + i)),
    tyresInner: range(0, 4, (i) => buf.readUInt8(o + 34 + i)),
  };
}

export interface StatusF1 {
  fuelInTank: number;
  fuelCapacity: number;
  fuelRemainingLaps: number;
  actualCompound: number;
  visualCompound: number;
  tyresAge: number;
  fiaFlag: number;
  ersStore: number;
}

export function readStatus(buf: Buffer, header: F1Header, index: number): StatusF1 | undefined {
  const slice = carSlice(buf, header, index, 0, 0);
  if (!slice || slice.stride < 41) return undefined;
  const o = slice.offset;
  return {
    fuelInTank: buf.readFloatLE(o + 5),
    fuelCapacity: buf.readFloatLE(o + 9),
    fuelRemainingLaps: buf.readFloatLE(o + 13),
    actualCompound: buf.readUInt8(o + 25),
    visualCompound: buf.readUInt8(o + 26),
    tyresAge: buf.readUInt8(o + 27),
    fiaFlag: buf.readInt8(o + 28),
    ersStore: buf.readFloatLE(o + 37),
  };
}

export interface DamageF1 {
  tyresWear: number[];
  frontLeftWing: number;
  frontRightWing: number;
  rearWing: number;
  floor: number;
  diffuser: number;
  sidepod: number;
  gearbox: number;
  engine: number;
}

export function readDamage(buf: Buffer, header: F1Header, index: number): DamageF1 | undefined {
  const slice = carSlice(buf, header, index, 0, 0);
  if (!slice || slice.stride < 38) return undefined;
  const o = slice.offset;
  return {
    tyresWear: Array.from({ length: 4 }, (_, i) => buf.readFloatLE(o + i * 4)),
    frontLeftWing: buf.readUInt8(o + 28),
    frontRightWing: buf.readUInt8(o + 29),
    rearWing: buf.readUInt8(o + 30),
    floor: buf.readUInt8(o + 31),
    diffuser: buf.readUInt8(o + 32),
    sidepod: buf.readUInt8(o + 33),
    gearbox: buf.readUInt8(o + 36),
    engine: buf.readUInt8(o + 37),
  };
}

export interface SessionF1 {
  weather: number;
  trackTemp: number;
  airTemp: number;
  totalLaps: number;
  sessionType: number;
  trackId: number;
  timeLeftS: number;
  safetyCarStatus: number;
  rainNextPct?: number;
  pitIdealLap: number;
  pitLatestLap: number;
}

export function readSession(buf: Buffer): SessionF1 | undefined {
  const o = HEADER_SIZE;
  if (buf.length < o + 656) return undefined;
  const marshalEnd = o + 19 + 21 * 5;
  const samples = buf.readUInt8(marshalEnd + 2);
  const sampleStart = marshalEnd + 3;
  // Premier échantillon de prévision au-delà de l'instant présent, pour la séance en cours.
  let rainNextPct: number | undefined;
  const sessionType = buf.readUInt8(o + 6);
  for (let i = 0; i < Math.min(samples, 64); i += 1) {
    const s = sampleStart + i * 8;
    if (buf.readUInt8(s) === sessionType && buf.readUInt8(s + 1) >= 5) {
      rainNextPct = buf.readUInt8(s + 7);
      break;
    }
  }
  const afterSamples = sampleStart + 64 * 8;
  return {
    weather: buf.readUInt8(o),
    trackTemp: buf.readInt8(o + 1),
    airTemp: buf.readInt8(o + 2),
    totalLaps: buf.readUInt8(o + 3),
    sessionType,
    trackId: buf.readInt8(o + 7),
    timeLeftS: buf.readUInt16LE(o + 9),
    safetyCarStatus: buf.readUInt8(marshalEnd),
    ...(rainNextPct !== undefined ? { rainNextPct } : {}),
    pitIdealLap: buf.readUInt8(afterSamples + 14),
    pitLatestLap: buf.readUInt8(afterSamples + 15),
  };
}

export interface EventF1 {
  code: string;
  vehicleIdx?: number;
  otherVehicleIdx?: number;
  penaltyType?: number;
  infringementType?: number;
  timeS?: number;
  lapTime?: number;
  safetyCarType?: number;
  safetyCarEvent?: number;
  /** Nom de l'autre pilote concerné (dépassement, accrochage). */
  otherName?: string;
}

export function readEvent(buf: Buffer): EventF1 | undefined {
  if (buf.length < HEADER_SIZE + 4) return undefined;
  const code = buf.toString("ascii", HEADER_SIZE, HEADER_SIZE + 4);
  const d = HEADER_SIZE + 4;
  const u8 = (i: number) => (buf.length > d + i ? buf.readUInt8(d + i) : 0);
  switch (code) {
    case "FTLP":
      return { code, vehicleIdx: u8(0), lapTime: buf.length >= d + 5 ? buf.readFloatLE(d + 1) : 0 };
    case "PENA":
      return { code, penaltyType: u8(0), infringementType: u8(1), vehicleIdx: u8(2), otherVehicleIdx: u8(3), timeS: u8(4) };
    case "OVTK":
      return { code, vehicleIdx: u8(0), otherVehicleIdx: u8(1) };
    case "SCAR":
      return { code, safetyCarType: u8(0), safetyCarEvent: u8(1) };
    case "COLL":
      return { code, vehicleIdx: u8(0), otherVehicleIdx: u8(1) };
    case "RTMT":
    case "TMPT":
    case "RCWN":
      return { code, vehicleIdx: u8(0) };
    default:
      return { code };
  }
}

export function readParticipantNames(buf: Buffer, header: F1Header): string[] {
  const cars = carCount(header);
  const stride = Math.floor((buf.length - HEADER_SIZE - 1) / cars);
  const nameOffset = header.packetFormat >= 2026 ? 10 : 7;
  const names: string[] = [];
  for (let i = 0; i < cars; i += 1) {
    const start = HEADER_SIZE + 1 + i * stride + nameOffset;
    const raw = buf.subarray(start, start + 32);
    const end = raw.indexOf(0);
    names.push(raw.subarray(0, end === -1 ? 32 : end).toString("utf8"));
  }
  return names;
}

const SESSION_TYPES: Record<number, string> = { 1: "Essais 1", 2: "Essais 2", 3: "Essais 3", 4: "Essais courts", 5: "Q1", 6: "Q2", 7: "Q3", 8: "Qualif courte", 9: "Qualif en un tour", 15: "Course", 16: "Course 2", 17: "Course 3", 18: "Contre-la-montre" };
const RACE_SESSIONS = new Set([15, 16, 17]);
// Sprint selon les versions : types 10 à 14 = qualifs sprint, la course sprint est un type « course ».
const COMPOUNDS: Record<number, string> = { 16: "tendres", 17: "médiums", 18: "durs", 7: "intermédiaires", 8: "pluie" };
const TRACKS: Record<number, string> = {
  0: "Melbourne", 2: "Shanghai", 3: "Bahreïn", 4: "Barcelone", 5: "Monaco", 6: "Montréal", 7: "Silverstone", 9: "Hungaroring", 10: "Spa",
  11: "Monza", 12: "Singapour", 13: "Suzuka", 14: "Abou Dabi", 15: "Austin", 16: "Interlagos", 17: "Autriche", 19: "Mexico", 20: "Bakou",
  26: "Zandvoort", 27: "Imola", 29: "Djeddah", 30: "Miami", 31: "Las Vegas", 32: "Losail",
};

/** Met à jour l'état de course avec un paquet F1. Renvoie l'événement éventuel (pénalité, voiture de sécurité…). */
export class F1Decoder {
  state: RaceState = emptyState("F1");
  private names: string[] = [];
  private session: bigint | undefined;
  private lastLapSeen = 0;
  private lastTelemetry: TelemetryF1 | undefined;
  /** Le tour en cours a-t-il été invalidé (coupe de piste) ? Lu juste avant qu'il se termine. */
  private invalidAtLapEnd = false;

  constructor(private readonly now: () => number = Date.now) {}

  get latestTelemetry(): TelemetryF1 | undefined {
    return this.lastTelemetry;
  }

  handle(buf: Buffer): EventF1 | undefined {
    const header = readHeader(buf);
    if (!header) return undefined;
    if (this.session !== header.sessionUID) {
      this.session = header.sessionUID;
      this.state = emptyState("F1");
      this.lastLapSeen = 0;
    }
    const me = header.playerCarIndex;
    const s = this.state;
    s.actif = true;
    s.miseAJour = this.now();
    switch (header.packetId) {
      case 1: {
        const session = readSession(buf);
        if (!session) break;
        s.session = SESSION_TYPES[session.sessionType] ?? `séance ${session.sessionType}`;
        s.enCourse = RACE_SESSIONS.has(session.sessionType);
        s.piste = TRACKS[session.trackId] ?? s.piste;
        s.totalTours = session.totalLaps || undefined;
        s.tempsRestantS = session.timeLeftS;
        s.meteo = { pisteC: session.trackTemp, airC: session.airTemp, ...(session.rainNextPct !== undefined ? { pluieProchainePct: session.rainNextPct } : {}) };
        s.stand = { ...s.stand, ...(session.pitIdealLap ? { tourIdeal: session.pitIdealLap } : {}), ...(session.pitLatestLap ? { tourMax: session.pitLatestLap } : {}) };
        if (session.safetyCarStatus === 1) s.drapeau = "safety_car";
        else if (session.safetyCarStatus === 2) s.drapeau = "vsc";
        else if (s.drapeau === "safety_car" || s.drapeau === "vsc") s.drapeau = "vert";
        break;
      }
      case 2: {
        const lap = readLapData(buf, header, me);
        if (!lap) break;
        s.tour = lap.lap;
        s.position = lap.position;
        s.tourActuelS = lap.currentLapMs / 1000;
        s.secteur = lap.sector + 1;
        s.tourInvalide = lap.lapInvalid;
        s.penalitesS = lap.penaltiesS;
        s.avertissements = lap.warnings;
        s.ecartDevantS = lap.position > 1 && lap.deltaFrontMs > 0 ? lap.deltaFrontMs / 1000 : undefined;
        s.ecartLeaderS = lap.position > 1 ? lap.deltaLeaderMs / 1000 : 0;
        s.stand = { ...s.stand, arrets: lap.pitStops, dansLaVoie: lap.pitStatus > 0 };
        // Voitures devant et derrière, et nombre de voitures classées.
        const cars: Array<{ index: number; position: number; deltaFrontMs: number }> = [];
        for (let i = 0; i < carCount(header); i += 1) {
          const other = readLapData(buf, header, i);
          if (other && other.position > 0 && other.resultStatus >= 2) cars.push({ index: i, position: other.position, deltaFrontMs: other.deltaFrontMs });
        }
        s.nbVoitures = cars.length || s.nbVoitures;
        const behind = cars.find((c) => c.position === lap.position + 1);
        const ahead = cars.find((c) => c.position === lap.position - 1);
        s.ecartDerriereS = behind && behind.deltaFrontMs > 0 ? behind.deltaFrontMs / 1000 : undefined;
        s.pilotes = { ...(ahead && this.names[ahead.index] ? { devant: this.names[ahead.index] } : {}), ...(behind && this.names[behind.index] ? { derriere: this.names[behind.index] } : {}) };
        // Tour bouclé : le numéro de tour augmente et le dernier temps change.
        if (lap.lap > this.lastLapSeen && this.lastLapSeen > 0 && lap.lastLapMs > 0) {
          const temps = lap.lastLapMs / 1000;
          s.dernierTourS = temps;
          const record = { numero: this.lastLapSeen, tempsS: temps, valide: !this.invalidAtLapEnd, position: lap.position, ...(s.carburant?.restant !== undefined ? { carburant: s.carburant.restant } : {}) };
          s.tours.push(record);
          if (record.valide && (s.meilleurTourS === undefined || temps < s.meilleurTourS)) s.meilleurTourS = temps;
          this.updateFuelPerLap();
        }
        this.invalidAtLapEnd = lap.lapInvalid;
        this.lastLapSeen = lap.lap;
        break;
      }
      case 3:
        return this.event(readEvent(buf), me);
      case 4:
        this.names = readParticipantNames(buf, header);
        break;
      case 6: {
        const t = readTelemetry(buf, header, me);
        if (!t) break;
        this.lastTelemetry = t;
        s.pneus = { ...s.pneus, surface: t.tyresSurface, coeur: t.tyresInner };
        s.freins = { temperature: t.brakesTemp };
        break;
      }
      case 7: {
        const st = readStatus(buf, header, me);
        if (!st) break;
        s.carburant = { ...s.carburant, unite: "kg", restant: round(st.fuelInTank, 2), capacite: round(st.fuelCapacity, 1), margeTours: round(st.fuelRemainingLaps, 2) };
        s.pneus = { ...s.pneus, compose: COMPOUNDS[st.visualCompound] ?? s.pneus?.compose, age: st.tyresAge };
        s.energie = { ...s.energie, fraction: round(st.ersStore / 4_000_000, 3) };
        const flags: Record<number, Flag> = { 1: "vert", 2: "bleu", 3: "jaune" };
        if (flags[st.fiaFlag] && s.drapeau !== "safety_car" && s.drapeau !== "vsc" && s.drapeau !== "rouge") s.drapeau = flags[st.fiaFlag];
        break;
      }
      case 10: {
        const d = readDamage(buf, header, me);
        if (!d) break;
        s.pneus = { ...s.pneus, usure: d.tyresWear.map((w) => round(w, 1)) };
        s.degats = { "aileron avant gauche": d.frontLeftWing, "aileron avant droit": d.frontRightWing, "aileron arrière": d.rearWing, fond: d.floor, diffuseur: d.diffuser, pontons: d.sidepod, "boîte de vitesses": d.gearbox, moteur: d.engine };
        break;
      }
    }
    return undefined;
  }

  private updateFuelPerLap(): void {
    const s = this.state;
    const withFuel = s.tours.filter((t) => t.carburant !== undefined).slice(-4);
    if (withFuel.length >= 2 && s.carburant) {
      const used = (withFuel[0]!.carburant! - withFuel.at(-1)!.carburant!) / (withFuel.length - 1);
      if (used > 0) {
        s.carburant.parTour = round(used, 2);
        if (s.carburant.restant !== undefined) s.carburant.toursRestants = round(s.carburant.restant / used, 1);
      }
    }
  }

  private event(event: EventF1 | undefined, me: number): EventF1 | undefined {
    if (!event) return undefined;
    const s = this.state;
    if (event.code === "SEND") s.actif = false;
    if (event.code === "CHQF") s.drapeau = "damier";
    if (event.code === "RDFL") s.drapeau = "rouge";
    if (event.code === "PENA" && event.vehicleIdx !== me) return undefined;
    if ((event.code === "OVTK" || event.code === "COLL") && event.vehicleIdx !== me && event.otherVehicleIdx !== me) return undefined;
    const otherIdx = event.vehicleIdx === me ? event.otherVehicleIdx : event.vehicleIdx;
    const otherName = otherIdx !== undefined ? this.names[otherIdx] : undefined;
    return otherName ? { ...event, otherName } : event;
  }

  nameOf(index: number): string | undefined {
    return this.names[index];
  }
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Écoute les paquets UDP envoyés par le jeu (par défaut sur le port 20777). */
export class F1Source {
  private socket: Socket | undefined;
  readonly decoder = new F1Decoder();

  constructor(private readonly port: number, private readonly onUpdate: (state: RaceState, event?: EventF1) => void) {}

  start(): void {
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    socket.on("message", (msg) => {
      const event = this.decoder.handle(msg);
      this.onUpdate(this.decoder.state, event);
    });
    socket.on("error", (error) => console.error("[F1]", error.message));
    socket.bind(this.port);
    this.socket = socket;
  }

  stop(): void {
    this.socket?.close();
    this.socket = undefined;
  }
}
