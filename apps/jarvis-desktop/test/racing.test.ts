import { describe, expect, it } from "vitest";
import { debrief, lapsCsv, quickAnswer, RaceEngineer } from "../src/main/racing/engineer.js";
import { F1Decoder, HEADER_SIZE, readHeader } from "../src/main/racing/f1.js";
import { LmuMapper } from "../src/main/racing/lmu.js";
import { formatLap, speakDelta, speakLap, type RaceState } from "../src/main/racing/state.js";

// ---------- Fabrique de paquets F1 25 (format officiel, little-endian) ----------

const CARS = 22;
function header(packetId: number, size: number, sessionUID = 42n, player = 3): Buffer {
  const buf = Buffer.alloc(size);
  buf.writeUInt16LE(2025, 0);
  buf.writeUInt8(25, 2);
  buf.writeUInt8(1, 5);
  buf.writeUInt8(packetId, 6);
  buf.writeBigUInt64LE(sessionUID, 7);
  buf.writeUInt8(player, 27);
  buf.writeUInt8(255, 28);
  return buf;
}

interface LapCar { lastLapMs?: number; currentMs?: number; deltaFrontMs?: number; position: number; lap: number; invalid?: boolean; pitStops?: number; penalties?: number }
function lapPacket(cars: Record<number, LapCar>): Buffer {
  const buf = header(2, HEADER_SIZE + CARS * 57 + 2);
  for (const [i, car] of Object.entries(cars)) {
    const o = HEADER_SIZE + Number(i) * 57;
    buf.writeUInt32LE(car.lastLapMs ?? 0, o);
    buf.writeUInt32LE(car.currentMs ?? 10_000, o + 4);
    buf.writeUInt16LE((car.deltaFrontMs ?? 0) % 60_000, o + 14);
    buf.writeUInt8(Math.floor((car.deltaFrontMs ?? 0) / 60_000), o + 16);
    buf.writeUInt8(car.position, o + 32);
    buf.writeUInt8(car.lap, o + 33);
    buf.writeUInt8(car.pitStops ?? 0, o + 35);
    buf.writeUInt8(car.invalid ? 1 : 0, o + 37);
    buf.writeUInt8(car.penalties ?? 0, o + 38);
    buf.writeUInt8(2, o + 45); // actif
  }
  return buf;
}

function statusPacket(player: number, fuel: number, marginLaps: number, visualCompound = 17, age = 6): Buffer {
  const buf = header(7, HEADER_SIZE + CARS * 55);
  const o = HEADER_SIZE + player * 55;
  buf.writeFloatLE(fuel, o + 5);
  buf.writeFloatLE(110, o + 9);
  buf.writeFloatLE(marginLaps, o + 13);
  buf.writeUInt8(visualCompound, o + 26);
  buf.writeUInt8(age, o + 27);
  buf.writeInt8(1, o + 28);
  return buf;
}

function damagePacket(player: number, wear: number[], frontLeftWing = 0): Buffer {
  const buf = header(10, HEADER_SIZE + CARS * 46);
  const o = HEADER_SIZE + player * 46;
  wear.forEach((w, i) => buf.writeFloatLE(w, o + i * 4));
  buf.writeUInt8(frontLeftWing, o + 28);
  return buf;
}

function telemetryPacket(player: number, surface: number[]): Buffer {
  const buf = header(6, HEADER_SIZE + CARS * 60 + 3);
  const o = HEADER_SIZE + player * 60;
  buf.writeUInt16LE(287, o);
  surface.forEach((t, i) => buf.writeUInt8(t, o + 30 + i));
  return buf;
}

function sessionPacket(totalLaps: number, sessionType = 15, trackId = 10, safetyCar = 0): Buffer {
  const buf = header(1, 753);
  const o = HEADER_SIZE;
  buf.writeUInt8(totalLaps, o + 3);
  buf.writeUInt8(sessionType, o + 6);
  buf.writeInt8(trackId, o + 7);
  buf.writeUInt8(safetyCar, o + 19 + 21 * 5);
  return buf;
}

function participantsPacket(names: Record<number, string>): Buffer {
  const buf = header(4, HEADER_SIZE + 1 + CARS * 57);
  buf.writeUInt8(CARS, HEADER_SIZE);
  for (const [i, name] of Object.entries(names)) buf.write(name, HEADER_SIZE + 1 + Number(i) * 57 + 7, "utf8");
  return buf;
}

function penaltyEvent(vehicle: number, seconds: number): Buffer {
  const buf = header(3, 45);
  buf.write("PENA", HEADER_SIZE, "ascii");
  buf.writeUInt8(vehicle, HEADER_SIZE + 4 + 2);
  buf.writeUInt8(seconds, HEADER_SIZE + 4 + 4);
  return buf;
}

describe("F1 : décodage des paquets", () => {
  it("lit l'en-tête et ignore les paquets étrangers", () => {
    expect(readHeader(header(6, 100))).toMatchObject({ packetFormat: 2025, packetId: 6, playerCarIndex: 3 });
    expect(readHeader(Buffer.from("bonjour"))).toBeUndefined();
  });

  it("reconstitue la course du joueur : tours, position, écarts, carburant, pneus, noms", () => {
    let now = 0;
    const decoder = new F1Decoder(() => now);
    decoder.handle(participantsPacket({ 3: "Alex", 1: "Verstappen", 5: "Leclerc" }));
    decoder.handle(sessionPacket(20));
    decoder.handle(statusPacket(3, 40, 0.4));
    decoder.handle(lapPacket({ 1: { position: 3, lap: 4 }, 3: { position: 4, lap: 4, deltaFrontMs: 1_450, lastLapMs: 0 }, 5: { position: 5, lap: 4, deltaFrontMs: 800 } }));
    decoder.handle(statusPacket(3, 38.2, 0.4));
    decoder.handle(lapPacket({ 1: { position: 3, lap: 5 }, 3: { position: 4, lap: 5, deltaFrontMs: 1_200, lastLapMs: 92_418 }, 5: { position: 5, lap: 5, deltaFrontMs: 650 } }));
    decoder.handle(damagePacket(3, [31.5, 28, 20, 19]));
    decoder.handle(telemetryPacket(3, [101, 99, 95, 96]));
    const s = decoder.state;
    expect(s).toMatchObject({ jeu: "F1", piste: "Spa", session: "Course", enCourse: true, totalTours: 20, tour: 5, position: 4, nbVoitures: 3, dernierTourS: 92.418, meilleurTourS: 92.418 });
    expect(s.ecartDevantS).toBeCloseTo(1.2);
    expect(s.ecartDerriereS).toBeCloseTo(0.65);
    expect(s.pilotes).toEqual({ devant: "Verstappen", derriere: "Leclerc" });
    expect(s.carburant).toMatchObject({ unite: "kg", restant: 38.2, margeTours: 0.4 });
    expect(s.pneus).toMatchObject({ compose: "médiums", age: 6, usure: [31.5, 28, 20, 19], surface: [101, 99, 95, 96] });
    expect(s.tours).toEqual([{ numero: 4, tempsS: 92.418, valide: true, position: 4, carburant: 38.2 }]);
  });

  it("ne retient que les pénalités du joueur et repart à zéro à chaque séance", () => {
    const decoder = new F1Decoder();
    expect(decoder.handle(penaltyEvent(7, 5))).toBeUndefined();
    expect(decoder.handle(penaltyEvent(3, 5))).toMatchObject({ code: "PENA", timeS: 5 });
    decoder.handle(lapPacket({ 3: { position: 2, lap: 1 } }));
    expect(decoder.state.tour).toBe(1);
    decoder.handle(header(2, HEADER_SIZE + CARS * 57 + 2, 99n));
    expect(decoder.state.tours).toEqual([]);
  });

  it("accepte le format 2026 (24 voitures)", () => {
    const buf = Buffer.alloc(HEADER_SIZE + 24 * 57 + 2);
    buf.writeUInt16LE(2026, 0);
    buf.writeUInt8(2, 6);
    buf.writeUInt8(23, 27);
    const o = HEADER_SIZE + 23 * 57;
    buf.writeUInt8(7, o + 32);
    buf.writeUInt8(2, o + 33);
    buf.writeUInt8(2, o + 45);
    const decoder = new F1Decoder();
    decoder.handle(buf);
    expect(decoder.state).toMatchObject({ position: 7, tour: 2 });
  });
});

function baseState(overrides: Partial<RaceState> = {}): RaceState {
  return { jeu: "F1", actif: true, miseAJour: 0, piste: "Spa", session: "Course", enCourse: true, totalTours: 20, tour: 6, position: 4, tours: [], ...overrides };
}

describe("ingénieur de course", () => {
  it("annonce le meilleur tour et l'écart sur les autres tours", () => {
    const engineer = new RaceEngineer({ verbosity: "normal", name: "Alex" });
    const s = baseState({ tours: [{ numero: 1, tempsS: 93.1, valide: true }], meilleurTourS: 93.1 });
    expect(engineer.update(s).map((m) => m.text)).toEqual(["1 minute 33 secondes 1."]);
    s.tours.push({ numero: 2, tempsS: 92.4, valide: true });
    s.meilleurTourS = 92.4;
    expect(engineer.update(s).map((m) => m.text)).toContain("1 minute 32 secondes 4, meilleur tour ! Superbe.");
    s.tours.push({ numero: 3, tempsS: 92.8, valide: true });
    expect(engineer.update(s)[0]!.text).toBe("1 minute 32 secondes 8, plus 4 dixièmes.");
    expect(engineer.update(s)).toEqual([]);
  });

  it("prévient une fois quand le carburant ne suffira pas", () => {
    const engineer = new RaceEngineer({ verbosity: "minimal", name: "Alex" });
    const s = baseState({ carburant: { unite: "kg", margeTours: -1.4 }, tours: [{ numero: 5, tempsS: 92, valide: true }] });
    const said = engineer.update(s);
    expect(said).toEqual([{ text: "Attention au carburant : il en manque environ 1,4 tour. Économise en levant avant les freinages.", priority: "critique" }]);
    s.tours.push({ numero: 6, tempsS: 92, valide: true });
    expect(engineer.update(s).some((m) => m.text.includes("carburant"))).toBe(false);
  });

  it("appelle au stand en endurance avant la panne d'énergie", () => {
    const engineer = new RaceEngineer({ verbosity: "minimal", name: "Alex" });
    const s = baseState({ jeu: "LMU", totalTours: undefined, energie: { fraction: 0.09, toursRestants: 1.4 }, tours: [{ numero: 30, tempsS: 210, valide: true }] });
    expect(engineer.update(s).map((m) => m.text)).toEqual(["Il te reste environ 1 tours d'énergie, prépare l'arrêt.", "Box, box ! Plus qu'un tour d'énergie."]);
  });

  it("signale usure, dégâts, voiture de sécurité, pénalité et bagarre, sans se répéter", () => {
    let now = 0;
    const engineer = new RaceEngineer({ verbosity: "normal", name: "Alex" }, () => now);
    const s = baseState({ pneus: { usure: [72, 60, 40, 41] }, degats: { "aileron avant gauche": 55 }, drapeau: "vert", ecartDerriereS: 0.6, pilotes: { derriere: "Leclerc" } });
    const first = engineer.update(s).map((m) => m.text);
    expect(first).toContain("Pneus : avant gauche à 72 % d'usure, ménage-les.");
    expect(first).toContain("Dégâts : aileron avant gauche à 55 %. Il faut rentrer changer l'aileron.");
    expect(first).toContain("Leclerc est à 0,6, défends.");
    s.drapeau = "safety_car";
    expect(engineer.update(s, { code: "PENA", timeS: 5 }).map((m) => m.text)).toEqual(["Pénalité de 5 secondes.", "Voiture de sécurité ! On réfléchit à l'arrêt."]);
    s.drapeau = "vert";
    expect(engineer.update(s).map((m) => m.text)).toEqual(["Fin de la neutralisation, drapeau vert, attaque !"]);
  });

  it("répond tout de suite aux questions courantes", () => {
    const s = baseState({
      carburant: { unite: "kg", restant: 12.5, margeTours: 0.8, parTour: 1.6 },
      pneus: { compose: "durs", age: 14, usure: [44, 52, 30, 31], surface: [96, 101, 92, 93] },
      ecartDevantS: 2.4,
      ecartDerriereS: 1.1,
      pilotes: { devant: "Norris", derriere: "Piastri" },
      nbVoitures: 20,
      dernierTourS: 92.418,
      meilleurTourS: 91.9,
    });
    expect(quickAnswer("Jarvis, il me reste combien d'essence ?", s)).toBe("Tu as 0,8 tour d'avance en carburant, 12,5 kilos dans le réservoir, 1,6 par tour.");
    expect(quickAnswer("Et les pneus ?", s)).toBe("Tu es en durs de 14 tours, le plus usé est l'avant droit à 52 %, températures 96, 101, 92, 93 degrés.");
    expect(quickAnswer("C'est quoi l'écart ?", s)).toBe("2,4 sur Norris, 1,1 d'avance sur Piastri.");
    expect(quickAnswer("Je suis à quelle position ?", s)).toBe("P4 sur 20.");
    expect(quickAnswer("Combien de tours restants ?", s)).toBe("Encore 15 tours, celui-ci compris.");
    expect(quickAnswer("Explique-moi pourquoi je perds du temps au Raidillon", s)).toBeUndefined();
  });

  it("fait le bilan de la séance et exporte les tours", () => {
    const s = baseState({ tours: [{ numero: 1, tempsS: 93, valide: true }, { numero: 2, tempsS: 92.5, valide: true }, { numero: 3, tempsS: 99, valide: false }, { numero: 4, tempsS: 92.7, valide: true }], position: 3, nbVoitures: 20 });
    expect(debrief(s)).toBe("Course à Spa (F1) : 4 tours, 1 invalidés. Meilleur tour 1:32.500, tour médian 1:32.700. Régularité : 0.21 s d'écart type. Arrivée P3 sur 20.");
    expect(lapsCsv(s).split("\n")[2]).toBe("2;92.500;oui;;;");
  });
});

describe("Le Mans Ultimate : lecture de l'API du jeu", () => {
  const info = { session: "RACE1", trackName: "Circuit de la Sarthe", timeRemainingInGamePhase: 5400, trackTemp: 24, ambientTemp: 18, gamePhase: 5, yellowFlagState: "none" };
  const car = (name: string, position: number, carClass: string, behindLeader: number, extra: Record<string, unknown> = {}) => ({ driverName: name, position, carClass, timeBehindLeader: behindLeader, lapsBehindLeader: 0, ...extra });

  it("se place dans sa catégorie et suit l'énergie tour après tour", () => {
    const mapper = new LmuMapper(() => 0);
    const standings = (laps: number, ve: number, last: number) => [
      car("Toyota #7", 1, "Hypercar", 0),
      car("Alex", 3, "Hypercar", 4.5, { player: true, lapsCompleted: laps, lastLapTime: last, bestLapTime: 207.9, veFraction: ve, pitstops: 0, pitState: "NONE" }),
      car("Ferrari #50", 2, "Hypercar", 2.1),
      car("Porsche #92", 4, "LMGT3", 0.5),
      car("Peugeot #93", 5, "Hypercar", 7.3),
    ];
    expect(mapper.apply({ standings: standings(10, 0.6, 208.4), sessionInfo: info })).toBeUndefined();
    expect(mapper.apply({ standings: standings(11, 0.52, 208.1), sessionInfo: info, vehicle: { fuel: 60, fuelCapacity: 90, tireCondition: [0.8, 0.82, 0.9, 0.91] } })).toEqual({ lap: 11, timeS: 208.1 });
    mapper.apply({ standings: standings(12, 0.44, 207.9), sessionInfo: info, vehicle: { fuel: 57, fuelCapacity: 90, tireCondition: [0.78, 0.8, 0.88, 0.9] } });
    const s = mapper.state;
    expect(s).toMatchObject({ jeu: "LMU", piste: "Circuit de la Sarthe", session: "Course", enCourse: true, classe: "Hypercar", position: 3, nbVoitures: 4, tour: 13, dernierTourS: 207.9, meilleurTourS: 207.9 });
    expect(s.ecartDevantS).toBeCloseTo(2.4);
    expect(s.ecartDerriereS).toBeCloseTo(2.8);
    expect(s.pilotes).toEqual({ devant: "Ferrari #50", derriere: "Peugeot #93" });
    expect(s.energie).toEqual({ fraction: 0.44, parTour: 0.08, toursRestants: 5.5 });
    expect(s.carburant).toMatchObject({ unite: "L", restant: 57, parTour: 3, toursRestants: 19 });
    expect(s.pneus?.usure).toEqual([22, 20, 12, 10]);
  });

  it("reste inactif sans voiture du joueur", () => {
    const mapper = new LmuMapper();
    mapper.apply({ standings: [], sessionInfo: info });
    expect(mapper.state.actif).toBe(false);
  });
});

describe("format des temps", () => {
  it("affiche et dit les temps", () => {
    expect(formatLap(207.918)).toBe("3:27.918");
    expect(formatLap(undefined)).toBe("—");
    expect(speakLap(58.36)).toBe("58 secondes 3");
    expect(speakDelta(-0.21)).toBe("moins 2 dixièmes");
    expect(speakDelta(1.34)).toBe("plus 1,3");
    expect(speakDelta(0.01)).toBe("même temps");
  });
});

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RaceManager } from "../src/main/racing/manager.js";

describe("chef d'orchestre de la course", () => {
  it("fait parler l'ingénieur et enregistre la séance quand le jeu s'arrête", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "jarvis-race-"));
    const radio: string[] = [];
    const ends: Array<{ summary: string; csv: string }> = [];
    const manager = new RaceManager({
      workspace,
      name: "Alex",
      verbosity: "normal",
      f1Port: 0,
      onRadio: (m) => radio.push(m.text),
      onState: () => undefined,
      onSessionEnd: (summary, csv) => ends.push({ summary, csv }),
    });
    const update = (manager as unknown as { update: (s: RaceState) => void }).update.bind(manager);
    const s = baseState({ actif: true, miseAJour: Date.now(), tours: [{ numero: 1, tempsS: 93.2, valide: true }], meilleurTourS: 93.2 });
    update(s);
    expect(manager.active).toBe(true);
    expect(manager.answer("je suis où ?")).toBeUndefined();
    expect(manager.answer("ma position ?")).toBe("P4.");
    s.actif = false;
    update(s);
    expect(radio).toEqual(["1 minute 33 secondes 2."]);
    expect(ends).toHaveLength(1);
    expect(ends[0]!.summary).toContain("Course à Spa (F1) : 1 tours");
    expect(readFileSync(ends[0]!.csv, "utf8")).toContain("1;93.200;oui");
    expect(ends[0]!.csv).toContain(path.join("simu", "F1"));
  });
});
