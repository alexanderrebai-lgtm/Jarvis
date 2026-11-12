/**
 * Météo par Open-Meteo (gratuit, sans compte ni clé) pour la ville réglée dans
 * JARVIS_VILLE. Rafraîchie toutes les 30 minutes.
 */

export interface Weather {
  ville: string;
  maintenant: { temperature: number; ressenti: number; code: number; libelle: string; icone: Icon; ventKmh: number };
  aujourdhui: { min: number; max: number; pluiePct: number; lever?: string; coucher?: string };
  demain?: { min: number; max: number; pluiePct: number; libelle: string; icone: Icon };
  prochainesHeures: Array<{ heure: string; temperature: number; pluiePct: number; icone: Icon }>;
  misAJour: string;
}

export type Icon = "soleil" | "nuageux" | "couvert" | "brouillard" | "bruine" | "pluie" | "neige" | "orage";

/** Codes météo de l'OMM (WMO) utilisés par Open-Meteo. */
export function describe(code: number): { libelle: string; icone: Icon } {
  if (code === 0) return { libelle: "Ensoleillé", icone: "soleil" };
  if (code === 1) return { libelle: "Plutôt dégagé", icone: "soleil" };
  if (code === 2) return { libelle: "Partiellement nuageux", icone: "nuageux" };
  if (code === 3) return { libelle: "Couvert", icone: "couvert" };
  if (code === 45 || code === 48) return { libelle: "Brouillard", icone: "brouillard" };
  if (code >= 51 && code <= 57) return { libelle: "Bruine", icone: "bruine" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { libelle: code >= 65 && code !== 80 ? "Forte pluie" : "Pluie", icone: "pluie" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { libelle: "Neige", icone: "neige" };
  if (code >= 95) return { libelle: "Orage", icone: "orage" };
  return { libelle: "Variable", icone: "nuageux" };
}

type Json = Record<string, any>;

/** Transforme la réponse d'Open-Meteo en météo prête à afficher et à dire. */
export function mapForecast(ville: string, data: Json, now = new Date()): Weather {
  const current = data.current ?? {};
  const daily = data.daily ?? {};
  const hourly = data.hourly ?? {};
  const now0 = describe(Number(current.weather_code ?? 0));
  const time = (iso?: string) => (iso ? iso.slice(11, 16) : undefined);
  const hours: Weather["prochainesHeures"] = [];
  const times: string[] = hourly.time ?? [];
  // Les heures d'Open-Meteo sont locales (timezone=auto) : on compare au même format.
  const nowLocal = String(current.time ?? "").slice(0, 13);
  const start = Math.max(0, times.findIndex((t) => t.slice(0, 13) >= nowLocal));
  for (let i = start + 1; i < Math.min(times.length, start + 13); i += 2) {
    hours.push({
      heure: times[i]!.slice(11, 16),
      temperature: Math.round(hourly.temperature_2m?.[i] ?? 0),
      pluiePct: Math.round(hourly.precipitation_probability?.[i] ?? 0),
      icone: describe(Number(hourly.weather_code?.[i] ?? 0)).icone,
    });
  }
  const tomorrow = daily.time?.length > 1 ? describe(Number(daily.weather_code?.[1] ?? 0)) : undefined;
  return {
    ville,
    maintenant: {
      temperature: Math.round(current.temperature_2m ?? 0),
      ressenti: Math.round(current.apparent_temperature ?? current.temperature_2m ?? 0),
      code: Number(current.weather_code ?? 0),
      libelle: now0.libelle,
      icone: now0.icone,
      ventKmh: Math.round(current.wind_speed_10m ?? 0),
    },
    aujourdhui: {
      min: Math.round(daily.temperature_2m_min?.[0] ?? 0),
      max: Math.round(daily.temperature_2m_max?.[0] ?? 0),
      pluiePct: Math.round(daily.precipitation_probability_max?.[0] ?? 0),
      ...(time(daily.sunrise?.[0]) ? { lever: time(daily.sunrise[0])! } : {}),
      ...(time(daily.sunset?.[0]) ? { coucher: time(daily.sunset[0])! } : {}),
    },
    ...(tomorrow
      ? {
          demain: {
            min: Math.round(daily.temperature_2m_min?.[1] ?? 0),
            max: Math.round(daily.temperature_2m_max?.[1] ?? 0),
            pluiePct: Math.round(daily.precipitation_probability_max?.[1] ?? 0),
            libelle: tomorrow.libelle,
            icone: tomorrow.icone,
          },
        }
      : {}),
    prochainesHeures: hours,
    misAJour: now.toISOString(),
  };
}

export class WeatherService {
  private cache: Weather | undefined;
  private coords: { lat: number; lon: number; name: string } | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(private ville: string | undefined, private readonly onUpdate: (weather: Weather) => void) {}

  /** Nouvelle ville (page Réglages) : prise en compte tout de suite. */
  setCity(ville: string | undefined): Promise<Weather | undefined> {
    this.ville = ville?.trim() || undefined;
    this.coords = undefined;
    this.cache = undefined;
    if (!this.timer) this.start();
    return this.refresh();
  }

  get current(): Weather | undefined {
    return this.cache;
  }

  start(): void {
    if (!this.ville) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 30 * 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh(): Promise<Weather | undefined> {
    if (!this.ville) return undefined;
    try {
      if (!this.coords) {
        const geo = (await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(this.ville)}&count=1&language=fr`)).json()) as Json;
        const place = geo.results?.[0];
        if (!place) throw new Error(`ville introuvable : ${this.ville}`);
        this.coords = { lat: place.latitude, lon: place.longitude, name: place.name };
      }
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${this.coords.lat}&longitude=${this.coords.lon}` +
        "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m" +
        "&hourly=temperature_2m,precipitation_probability,weather_code" +
        "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset" +
        "&timezone=auto&forecast_days=2";
      const data = (await (await fetch(url)).json()) as Json;
      this.cache = mapForecast(this.coords.name, data);
      this.onUpdate(this.cache);
      return this.cache;
    } catch (error) {
      console.warn("[météo]", error instanceof Error ? error.message : error);
      return this.cache;
    }
  }
}
