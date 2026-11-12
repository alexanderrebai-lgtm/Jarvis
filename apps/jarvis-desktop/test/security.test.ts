import { describe, expect, it } from "vitest";
import { JpegSplitter, MotionDetector, parseCameras, rtspUrl } from "../src/main/security.js";
import { perfAlerts } from "../src/main/perf.js";
import { describe as describeWeather, mapForecast } from "../src/main/weather.js";

describe("caméras Tapo", () => {
  it("lit la liste et construit l'adresse du flux", () => {
    const cams = parseCameras("Entrée=192.168.1.30, Jardin = 192.168.1.31");
    expect(cams).toEqual([{ nom: "Entrée", ip: "192.168.1.30" }, { nom: "Jardin", ip: "192.168.1.31" }]);
    expect(rtspUrl(cams[0]!, "alex", "m@t p", "basse")).toBe("rtsp://alex:m%40t%20p@192.168.1.30:554/stream2");
    expect(() => parseCameras("Entrée")).toThrow(/Nom=IP/);
    expect(() => parseCameras("X=1.2.3.4;rm -rf")).toThrow();
  });

  it("découpe un flux MJPEG même coupé au milieu d'une image", () => {
    const jpeg = (n: number) => Buffer.from([0xff, 0xd8, n, n, 0xff, 0xd9]);
    const stream = Buffer.concat([jpeg(1), jpeg(2), jpeg(3)]);
    const splitter = new JpegSplitter();
    const a = splitter.push(stream.subarray(0, 8));
    const b = splitter.push(stream.subarray(8));
    expect([...a, ...b].map((f) => f[2])).toEqual([1, 2, 3]);
  });

  it("détecte un intrus, pas un changement de lumière ni un bruit isolé", () => {
    let now = 0;
    const detector = new MotionDetector({ now: () => now });
    const scene = () => new Uint8Array(64 * 36).fill(100);
    const withPerson = () => {
      const f = scene();
      for (let y = 10; y < 30; y += 1) for (let x = 20; x < 30; x += 1) f[y * 64 + x] = 220;
      return f;
    };
    detector.push(scene());
    expect(detector.push(scene())).toBeUndefined();
    expect(detector.push(withPerson())).toBeUndefined(); // une seule image : on attend confirmation
    expect(detector.push(withPerson())).toBeGreaterThan(5);
    now = 10_000;
    expect(detector.push(withPerson())).toBeUndefined(); // pas de répétition pendant une minute
    const light = new Uint8Array(64 * 36).fill(240);
    const lamp = new MotionDetector();
    lamp.push(scene());
    lamp.push(light);
    expect(lamp.push(light)).toBeUndefined();
  });
});

describe("performances", () => {
  it("lève des alertes claires", () => {
    const base = {
      instant: "",
      cpu: { modele: "Ryzen", chargePct: 95, coeurs: [], temperatureC: 92 },
      memoire: { utiliseeGo: 30, totaleGo: 32, pct: 94 },
      gpu: [{ modele: "RTX", temperatureC: 87 }],
      disques: [{ lecteur: "C:", utilisePct: 95, libreGo: 24 }],
      reseau: { recuMbps: 0, envoyeMbps: 0 },
      processus: [],
    };
    expect(perfAlerts(base)).toEqual(["Processeur à 95 %", "Processeur à 92 °C", "Mémoire presque pleine (94 %)", "Carte graphique à 87 °C", "Disque C: presque plein (24 Go libres)"]);
  });
});

describe("météo", () => {
  it("traduit les codes et prépare la journée", () => {
    expect(describeWeather(61)).toEqual({ libelle: "Pluie", icone: "pluie" });
    expect(describeWeather(95).icone).toBe("orage");
    const hours = Array.from({ length: 48 }, (_, i) => `2026-11-12T${String(i % 24).padStart(2, "0")}:00`);
    const w = mapForecast("Lyon", {
      current: { time: "2026-11-12T09:15", temperature_2m: 7.6, apparent_temperature: 5.1, weather_code: 3, wind_speed_10m: 14 },
      hourly: { time: hours, temperature_2m: hours.map((_, i) => i), precipitation_probability: hours.map(() => 20), weather_code: hours.map(() => 61) },
      daily: { time: ["2026-11-12", "2026-11-13"], weather_code: [3, 0], temperature_2m_max: [11.2, 13], temperature_2m_min: [3.4, 2], precipitation_probability_max: [40, 5], sunrise: ["2026-11-12T07:41"], sunset: ["2026-11-12T17:12"] },
    });
    expect(w.maintenant).toEqual({ temperature: 8, ressenti: 5, code: 3, libelle: "Couvert", icone: "couvert", ventKmh: 14 });
    expect(w.aujourdhui).toEqual({ min: 3, max: 11, pluiePct: 40, lever: "07:41", coucher: "17:12" });
    expect(w.demain).toMatchObject({ libelle: "Ensoleillé", max: 13 });
    expect(w.prochainesHeures[0]).toEqual({ heure: "10:00", temperature: 10, pluiePct: 20, icone: "pluie" });
    expect(w.prochainesHeures).toHaveLength(6);
  });
});
