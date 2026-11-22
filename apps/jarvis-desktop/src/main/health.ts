import { createServer, type Server } from "node:http";
import { JsonStore } from "@muscu/jarvis/src/store.js";

/**
 * Santé : Jarvis reçoit les données de ta montre (pas, rythme cardiaque,
 * sommeil…) poussées par une appli du téléphone, sur le réseau de la maison,
 * sans passer par aucun cloud. Marche avec :
 *  - iPhone / Apple Santé : appli « Health Auto Export » → REST API ;
 *  - Android / Health Connect (Huawei Health via un pont comme Health Sync) :
 *    appli qui envoie par webhook ;
 *  - n'importe quoi qui sait faire un POST JSON.
 * Un jeton protège la réception ; rien ne sort du PC.
 */

/** Types de mesure que Jarvis comprend (clé interne). */
export type MetricType = "pas" | "rythme" | "rythme-repos" | "sommeil" | "calories" | "spo2" | "poids" | "stress" | "distance" | "etages" | "tension";

export interface Sample {
  type: MetricType;
  valeur: number;
  unite?: string;
  instant: string;
}

export interface HealthSummary {
  type: MetricType;
  libelle: string;
  valeur: number;
  unite: string;
  instant: string;
}

const LABELS: Record<MetricType, { libelle: string; unite: string; agrege: "dernier" | "somme-jour" }> = {
  pas: { libelle: "Pas aujourd'hui", unite: "pas", agrege: "somme-jour" },
  rythme: { libelle: "Rythme cardiaque", unite: "bpm", agrege: "dernier" },
  "rythme-repos": { libelle: "Rythme au repos", unite: "bpm", agrege: "dernier" },
  sommeil: { libelle: "Sommeil", unite: "h", agrege: "dernier" },
  calories: { libelle: "Calories actives", unite: "kcal", agrege: "somme-jour" },
  spo2: { libelle: "Oxygène (SpO₂)", unite: "%", agrege: "dernier" },
  poids: { libelle: "Poids", unite: "kg", agrege: "dernier" },
  stress: { libelle: "Stress", unite: "", agrege: "dernier" },
  distance: { libelle: "Distance aujourd'hui", unite: "km", agrege: "somme-jour" },
  etages: { libelle: "Étages montés", unite: "", agrege: "somme-jour" },
  tension: { libelle: "Tension", unite: "mmHg", agrege: "dernier" },
};

/** Noms venus des applis (Apple/Health Connect, FR/EN) → type interne. */
const ALIASES: Array<[RegExp, MetricType]> = [
  [/step|pas\b|step_count/i, "pas"],
  [/resting.*heart|heart.*rest|rythme.*repos|repos.*card/i, "rythme-repos"],
  [/heart|rythme|card|bpm|pouls/i, "rythme"],
  [/sleep|sommeil/i, "sommeil"],
  [/active.*energy|calor|kcal/i, "calories"],
  [/oxygen|spo2|saturation/i, "spo2"],
  [/weight|poids|masse/i, "poids"],
  [/stress/i, "stress"],
  [/distance|marche|walk/i, "distance"],
  [/floor|flight|etage|étage|stair/i, "etages"],
  [/pressure|tension|blood.*press/i, "tension"],
];

export function toType(name: string): MetricType | undefined {
  for (const [re, t] of ALIASES) if (re.test(name)) return t;
  return undefined;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Transforme un corps JSON (plusieurs formats) en mesures.
 * Accepte : le format « Health Auto Export » ({data:{metrics:[{name,units,data:[{date,qty}]}]}}),
 * un objet simple ({pas:8000, rythme:62}) ou une liste ([{type,valeur,instant}]).
 */
export function parsePayload(body: unknown, now = () => new Date()): Sample[] {
  const out: Sample[] = [];
  const push = (name: string, valeur: number | undefined, unite?: string, instant?: string) => {
    const type = toType(name);
    if (type && valeur !== undefined) out.push({ type, valeur, ...(unite ? { unite } : {}), instant: instant ?? now().toISOString() });
  };
  const b = body as Record<string, unknown>;
  const metrics = (b?.data as { metrics?: unknown })?.metrics ?? b?.metrics;
  if (Array.isArray(metrics)) {
    for (const m of metrics as Array<Record<string, unknown>>) {
      const name = String(m.name ?? m.type ?? "");
      const unite = m.units ? String(m.units) : undefined;
      const points = Array.isArray(m.data) ? (m.data as Array<Record<string, unknown>>) : [];
      if (points.length) {
        // Toutes les mesures du lot (une par heure ou par jour selon l'appli), pas seulement la dernière :
        // Health Auto Export renvoie les pas heure par heure. Le sommeil est en heures (totalSleep / asleep).
        for (const p of points.slice(-200)) push(name, num(p.qty ?? p.value ?? p.valeur ?? p.Avg ?? p.avg ?? p.totalSleep ?? p.asleep), unite, parseDate(p.date));
      } else push(name, num(m.qty ?? m.value ?? m.valeur), unite);
    }
    return out;
  }
  if (Array.isArray(body)) {
    for (const m of body as Array<Record<string, unknown>>) push(String(m.type ?? m.name ?? ""), num(m.valeur ?? m.value ?? m.qty), m.unite ? String(m.unite) : undefined, m.instant ? String(m.instant) : undefined);
    return out;
  }
  if (b && typeof b === "object") {
    if (parseHealthConnect(b, out)) return out;
    for (const [k, v] of Object.entries(b)) push(k, num(v));
  }
  return out;
}

const iso = (v: unknown): string | undefined => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
};

/**
 * Format des applis Android qui lisent Health Connect et envoient un webhook (ex. « Health Connect Webhook ») :
 * un objet avec une liste par type de mesure (steps, heart_rate, sleep, active_calories, oxygen_saturation,
 * weight, distance), chaque élément ayant son heure (time, end_time ou session_end_time).
 */
function parseHealthConnect(b: Record<string, unknown>, out: Sample[]): boolean {
  const liste = (k: string): Array<Record<string, unknown>> => (Array.isArray(b[k]) ? (b[k] as Array<Record<string, unknown>>).filter((x) => x && typeof x === "object") : []);
  const cles = ["steps", "heart_rate", "sleep", "active_calories", "oxygen_saturation", "weight", "distance"];
  if (!cles.some((k) => Array.isArray(b[k]))) return false;
  const when = (r: Record<string, unknown>) => iso(r.end_time ?? r.time ?? r.session_end_time ?? r.start_time) ?? new Date().toISOString();
  const add = (type: MetricType, valeur: number | undefined, instant: string, unite?: string) => {
    if (valeur !== undefined) out.push({ type, valeur, ...(unite ? { unite } : {}), instant });
  };
  for (const r of liste("steps")) add("pas", num(r.count), when(r));
  for (const r of liste("heart_rate").slice(-50)) add("rythme", num(r.bpm ?? r.avg), when(r), "bpm");
  for (const r of liste("sleep")) {
    const s = num(r.duration_seconds);
    add("sommeil", s !== undefined ? Math.round((s / 3600) * 10) / 10 : undefined, when(r), "h");
  }
  for (const r of liste("active_calories")) add("calories", num(r.calories), when(r), "kcal");
  for (const r of liste("oxygen_saturation").slice(-20)) add("spo2", num(r.percentage ?? r.avg), when(r), "%");
  for (const r of liste("weight")) add("poids", num(r.kilograms), when(r), "kg");
  for (const r of liste("distance")) {
    const m = num(r.meters);
    add("distance", m !== undefined ? Math.round((m / 1000) * 100) / 100 : undefined, when(r), "km");
  }
  return true;
}

/** « 2026-11-23 08:00:00 +0100 » (Health Auto Export) ou date ISO → ISO ; undefined si illisible. */
function parseDate(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  let t = Date.parse(v);
  if (!Number.isFinite(t)) t = Date.parse(v.replace(" ", "T").replace(/ ?([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

function isoDay(iso: string): string {
  return iso.slice(0, 10);
}

export class HealthStore {
  private readonly store: JsonStore<Sample[]>;

  constructor(dataDir: string, private readonly max = 5000) {
    this.store = new JsonStore(dataDir, "sante", () => []);
  }

  /**
   * Enregistre les mesures. Une mesure est identifiée par son type et son heure : si l'appli renvoie la même
   * heure avec une valeur à jour (le total de pas du jour qui grandit), elle remplace l'ancienne au lieu de
   * s'y ajouter ; un lot renvoyé tel quel après un échec ne change rien.
   */
  ingest(samples: Sample[]): number {
    if (!samples.length) return 0;
    let ecrits = 0;
    this.store.update((all) => {
      const out = [...all];
      const index = new Map<string, number>(out.map((s, i) => [`${s.type}|${s.instant}`, i]));
      for (const s of samples) {
        const k = `${s.type}|${s.instant}`;
        const i = index.get(k);
        if (i === undefined) {
          index.set(k, out.length);
          out.push(s);
          ecrits++;
        } else if (out[i]!.valeur !== s.valeur) {
          out[i] = s;
          ecrits++;
        }
      }
      return out.slice(-this.max);
    });
    return ecrits;
  }

  all(): Sample[] {
    return this.store.read();
  }

  /** Dernière valeur par type (les cumuls du jour, comme les pas, sont sommés sur aujourd'hui). */
  summary(now = () => new Date()): HealthSummary[] {
    const today = now().toISOString().slice(0, 10);
    const byType = new Map<MetricType, Sample[]>();
    for (const s of this.store.read()) byType.set(s.type, [...(byType.get(s.type) ?? []), s]);
    const res: HealthSummary[] = [];
    for (const [type, samples] of byType) {
      const meta = LABELS[type];
      samples.sort((a, b) => a.instant.localeCompare(b.instant));
      const last = samples[samples.length - 1]!;
      let valeur = last.valeur;
      if (meta.agrege === "somme-jour") valeur = samples.filter((s) => isoDay(s.instant) === today).reduce((a, s) => a + s.valeur, 0);
      res.push({ type, libelle: meta.libelle, valeur: Math.round(valeur * 10) / 10, unite: last.unite ?? meta.unite, instant: last.instant });
    }
    return res.sort((a, b) => a.libelle.localeCompare(b.libelle));
  }

  /** Série récente d'un type, pour un graphique (max points). */
  serie(type: MetricType, points = 60): Array<{ instant: string; valeur: number }> {
    return this.store
      .read()
      .filter((s) => s.type === type)
      .slice(-points)
      .map((s) => ({ instant: s.instant, valeur: s.valeur }));
  }

  /** Phrase courte pour le briefing du matin ou Claude. */
  phrase(now = () => new Date()): string {
    const s = this.summary(now);
    if (!s.length) return "Aucune donnée de santé reçue pour l'instant.";
    return s.map((x) => `${x.libelle} : ${x.valeur}${x.unite ? " " + x.unite : ""}`).join(" · ");
  }
}

/** Petit serveur qui reçoit les données du téléphone (POST /sante, protégé par jeton). */
export class HealthServer {
  private server: Server | undefined;

  constructor(
    private readonly store: HealthStore,
    private readonly options: { port: number; token: string; onIngest?: (n: number) => void },
  ) {}

  start(): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      if (this.server) return resolve({ ok: true, message: "déjà démarré" });
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://x");
        const token = req.headers["x-jeton"] ?? req.headers["authorization"]?.toString().replace(/^Bearer\s+/i, "") ?? url.searchParams.get("jeton");
        if (this.options.token && token !== this.options.token) return void res.writeHead(401).end("jeton invalide");
        if (req.method !== "POST") return void res.writeHead(200, { "content-type": "text/plain" }).end("Jarvis santé : prêt (POST JSON sur /sante).");
        let body = "";
        let tooBig = false;
        req.on("data", (c) => {
          body += c;
          if (body.length > 2_000_000) {
            tooBig = true;
            req.destroy();
          }
        });
        req.on("end", () => {
          if (tooBig) return;
          try {
            const n = this.store.ingest(parsePayload(JSON.parse(body || "{}")));
            this.options.onIngest?.(n);
            res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, recu: n }));
          } catch {
            res.writeHead(400).end("JSON invalide");
          }
        });
      });
      server.on("error", (error) => resolve({ ok: false, message: error instanceof Error ? error.message : String(error) }));
      server.listen(this.options.port, "0.0.0.0", () => {
        this.server = server;
        resolve({ ok: true, message: `à l'écoute sur le port ${this.options.port}` });
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = undefined;
  }
}
