import si from "systeminformation";

/**
 * Performances du PC : processeur, mémoire, carte graphique, disques, réseau,
 * températures (quand Windows les expose) et programmes les plus gourmands.
 */

export interface PerfSnapshot {
  instant: string;
  cpu: { modele: string; chargePct: number; coeurs: number[]; temperatureC?: number; frequenceGHz?: number };
  memoire: { utiliseeGo: number; totaleGo: number; pct: number };
  gpu: Array<{ modele: string; chargePct?: number; memoireUtiliseeGo?: number; memoireTotaleGo?: number; temperatureC?: number; ventilateurPct?: number; puissanceW?: number }>;
  disques: Array<{ lecteur: string; utilisePct: number; libreGo: number }>;
  reseau: { recuMbps: number; envoyeMbps: number };
  processus: Array<{ nom: string; cpuPct: number; memoireMo: number }>;
  alertes: string[];
}

const GB = 1024 ** 3;
const round = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? undefined : Math.round(v * 10 ** d) / 10 ** d);

/** Alertes simples à partir d'une mesure (fonction pure, testable). */
export function perfAlerts(s: Omit<PerfSnapshot, "alertes">): string[] {
  const alerts: string[] = [];
  if (s.cpu.chargePct >= 90) alerts.push(`Processeur à ${Math.round(s.cpu.chargePct)} %`);
  if (s.cpu.temperatureC !== undefined && s.cpu.temperatureC >= 90) alerts.push(`Processeur à ${Math.round(s.cpu.temperatureC)} °C`);
  if (s.memoire.pct >= 90) alerts.push(`Mémoire presque pleine (${Math.round(s.memoire.pct)} %)`);
  for (const gpu of s.gpu) if (gpu.temperatureC !== undefined && gpu.temperatureC >= 85) alerts.push(`Carte graphique à ${Math.round(gpu.temperatureC)} °C`);
  for (const disk of s.disques) if (disk.utilisePct >= 92) alerts.push(`Disque ${disk.lecteur} presque plein (${disk.libreGo} Go libres)`);
  return alerts;
}

export class PerfMonitor {
  private latest: PerfSnapshot | undefined;
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  private slow: { disques: PerfSnapshot["disques"]; processus: PerfSnapshot["processus"]; modele: string; at: number } | undefined;
  /** Détail (disques, programmes) toutes les 10 s quand la page Performances est ouverte, sinon toutes les minutes. */
  detailed = false;

  constructor(private readonly onSample: (s: PerfSnapshot) => void) {}

  get current(): PerfSnapshot | undefined {
    return this.latest;
  }

  /** Mesure régulière (toutes les 3 s par défaut) : jauges de l'accueil et page Performances. */
  start(intervalMs = 3000): void {
    if (this.timer) return;
    void this.sample();
    this.timer = setInterval(() => void this.sample(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async sample(): Promise<PerfSnapshot | undefined> {
    if (this.busy) return this.latest;
    this.busy = true;
    try {
      const [load, mem, graphics, temp, speed, net] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.graphics().catch(() => ({ controllers: [] as si.Systeminformation.GraphicsControllerData[] })),
        si.cpuTemperature().catch(() => ({ main: null })),
        si.cpuCurrentSpeed().catch(() => ({ avg: null })),
        si.networkStats().catch(() => [] as si.Systeminformation.NetworkStatsData[]),
      ]);
      // Disques, programmes et modèle du processeur : plus lents, toutes les 10 s.
      if (!this.slow || Date.now() - this.slow.at > (this.detailed ? 10_000 : 60_000)) {
        const [fs, procs, cpu] = await Promise.all([si.fsSize().catch(() => []), si.processes().catch(() => ({ list: [] as si.Systeminformation.ProcessesProcessData[] })), si.cpu().catch(() => ({ brand: "", manufacturer: "" }))]);
        this.slow = {
          at: Date.now(),
          modele: `${cpu.manufacturer} ${cpu.brand}`.trim(),
          disques: fs.filter((d) => d.size > 0).map((d) => ({ lecteur: d.mount || d.fs, utilisePct: Math.round(d.use), libreGo: Math.round((d.size - d.used) / GB) })),
          processus: [...procs.list]
            .sort((a, b) => b.cpu - a.cpu)
            .slice(0, 6)
            .map((p) => ({ nom: p.name, cpuPct: round(p.cpu) ?? 0, memoireMo: Math.round((p.memRss ?? 0) / 1024) })),
        };
      }
      const base: Omit<PerfSnapshot, "alertes"> = {
        instant: new Date().toISOString(),
        cpu: {
          modele: this.slow.modele,
          chargePct: round(load.currentLoad) ?? 0,
          coeurs: load.cpus.map((c) => Math.round(c.load)),
          ...(temp.main ? { temperatureC: round(temp.main)! } : {}),
          ...(speed.avg ? { frequenceGHz: round(speed.avg, 2)! } : {}),
        },
        memoire: { utiliseeGo: round((mem.total - mem.available) / GB)!, totaleGo: round(mem.total / GB)!, pct: round(((mem.total - mem.available) / mem.total) * 100)! },
        gpu: graphics.controllers
          .filter((g) => g.vram === undefined || (g.vram ?? 0) > 256)
          .map((g) => ({
            modele: g.model,
            ...(g.utilizationGpu !== undefined && g.utilizationGpu !== null ? { chargePct: g.utilizationGpu } : {}),
            ...(g.memoryUsed ? { memoireUtiliseeGo: round(g.memoryUsed / 1024)! } : {}),
            ...(g.memoryTotal ? { memoireTotaleGo: round(g.memoryTotal / 1024)! } : {}),
            ...(g.temperatureGpu ? { temperatureC: g.temperatureGpu } : {}),
            ...(g.fanSpeed ? { ventilateurPct: g.fanSpeed } : {}),
            ...(g.powerDraw ? { puissanceW: round(g.powerDraw)! } : {}),
          })),
        disques: this.slow.disques,
        reseau: {
          recuMbps: round(net.reduce((a, n) => a + Math.max(0, n.rx_sec ?? 0), 0) * 8 / 1e6) ?? 0,
          envoyeMbps: round(net.reduce((a, n) => a + Math.max(0, n.tx_sec ?? 0), 0) * 8 / 1e6) ?? 0,
        },
        processus: this.slow.processus,
      };
      this.latest = { ...base, alertes: perfAlerts(base) };
      this.onSample(this.latest);
      return this.latest;
    } catch (error) {
      console.warn("[perf]", error);
      return this.latest;
    } finally {
      this.busy = false;
    }
  }
}
