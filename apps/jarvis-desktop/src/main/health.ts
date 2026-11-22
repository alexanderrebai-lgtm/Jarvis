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
  [/floor|etage|étage|stair/i, "etages"],
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
        const last = points[points.length - 1]!;
        push(name, num(last.qty ?? last.value ?? last.valeur ?? last.Avg ?? last.avg), unite, last.date ? new Date(String(last.date)).toISOString() : undefined);
      } else push(name, num(m.qty ?? m.value ?? m.valeur), unite);
    }
    return out;
  }
  if (Array.isArray(body)) {
    for (const m of body as Array<Record<string, unknown>>) push(String(m.type ?? m.name ?? ""), num(m.valeur ?? m.value ?? m.qty), m.unite ? String(m.unite) : undefined, m.instant ? String(m.instant) : undefined);
    return out;
  }
  if (b && typeof b === "object") for (const [k, v] of Object.entries(b)) push(k, num(v));
  return out;
}

function isoDay(iso: string): string {
  return iso.slice(0, 10);
}

export class HealthStore {
  private readonly store: JsonStore<Sample[]>;

  constructor(dataDir: string, private readonly max = 5000) {
    this.store = new JsonStore(dataDir, "sante", () => []);
  }

  ingest(samples: Sample[]): number {
    if (!samples.length) return 0;
    this.store.update((all) => [...all, ...samples].slice(-this.max));
    return samples.length;
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
