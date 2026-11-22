import { execFile, spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
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

/** Charge du processeur (globale et par cœur) entre deux lectures de os.cpus() : instantané, sans programme externe. */
export function cpuLoad(previous: os.CpuInfo["times"][], current: os.CpuInfo["times"][]): { total: number; coeurs: number[] } {
  const coeurs = current.map((t, i) => {
    const p = previous[i];
    if (!p) return 0;
    const busy = t.user - p.user + (t.nice - p.nice) + (t.sys - p.sys) + (t.irq - p.irq);
    const total = busy + (t.idle - p.idle);
    return total > 0 ? Math.round((busy / total) * 100) : 0;
  });
  const total = coeurs.length ? coeurs.reduce((a, b) => a + b, 0) / coeurs.length : 0;
  return { total: Math.round(total * 10) / 10, coeurs };
}

type GpuReading = PerfSnapshot["gpu"][number];

/** Une ligne de nvidia-smi (nom, charge, mémoire, température, ventilateur, puissance) → mesure. */
export function parseNvidiaLine(line: string): GpuReading | undefined {
  const v = line.split(",").map((x) => x.trim());
  if (v.length < 7 || !v[0]) return undefined;
  const n = (i: number) => {
    const x = Number(v[i]);
    return Number.isFinite(x) ? x : undefined;
  };
  const g: GpuReading = { modele: v[0] };
  if (n(1) !== undefined) g.chargePct = n(1)!;
  if (n(2) !== undefined) g.memoireUtiliseeGo = round(n(2)! / 1024)!;
  if (n(3) !== undefined) g.memoireTotaleGo = round(n(3)! / 1024)!;
  if (n(4) !== undefined) g.temperatureC = n(4)!;
  if (n(5) !== undefined) g.ventilateurPct = n(5)!;
  if (n(6) !== undefined) g.puissanceW = round(n(6)!)!;
  return g;
}

const NVIDIA_QUERY = "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,fan.speed,power.draw";

/**
 * Mesures du PC en deux vitesses :
 * - rapide (1 s quand la page Performances est ouverte, 3 s sinon, 20 s en jeu) : processeur et mémoire
 *   lus directement (gratuit), carte NVIDIA par un seul nvidia-smi qui envoie une ligne par seconde ;
 * - lente, en arrière-plan et sans jamais bloquer la rapide : réseau, disques, programmes, température et
 *   fréquence du processeur (chacune à son rythme ; la température est abandonnée si Windows ne la donne pas).
 */
export class PerfMonitor {
  private latest: PerfSnapshot | undefined;
  private timer: NodeJS.Timeout | undefined;
  private cpuTimes = os.cpus().map((c) => c.times);
  private gpuStream: ChildProcess | undefined;
  private gpuStreamFailed = false;
  private gpu: GpuReading[] = [];
  private gpuAt = 0;
  private slowBusy = false;
  private readonly last: Record<string, number> = {};
  private slow = {
    modele: (os.cpus()[0]?.model ?? "").trim(),
    temperatureC: undefined as number | undefined,
    temperatureMisses: 0,
    frequenceGHz: undefined as number | undefined,
    disques: [] as PerfSnapshot["disques"],
    processus: [] as PerfSnapshot["processus"],
    reseau: { recuMbps: 0, envoyeMbps: 0 },
  };
  private detailedMode = false;
  private game = false;

  constructor(private readonly onSample: (s: PerfSnapshot) => void) {}

  get current(): PerfSnapshot | undefined {
    return this.latest;
  }

  /** Page Performances ouverte : mesures chaque seconde et carte graphique en continu. */
  get detailed(): boolean {
    return this.detailedMode;
  }

  set detailed(on: boolean) {
    this.detailedMode = on;
    if (on) this.startGpuStream();
    else this.stopGpuStream();
    this.reschedule();
  }

  /** Pendant un jeu : une mesure toutes les 20 s. */
  set gameMode(on: boolean) {
    this.game = on;
    if (on) this.stopGpuStream();
    else if (this.detailedMode) this.startGpuStream();
    this.reschedule();
  }

  private get intervalMs(): number {
    return this.game ? 20_000 : this.detailedMode ? 1_000 : 3_000;
  }

  private running = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.sample();
    this.reschedule();
  }

  /** Conservé pour compatibilité : le rythme suit maintenant la page ouverte et le mode jeu. */
  setInterval(intervalMs: number): void {
    this.gameMode = intervalMs >= 20_000;
  }

  private reschedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = this.running ? setInterval(() => void this.sample(), this.intervalMs) : undefined;
  }

  stop(): void {
    this.running = false;
    this.reschedule();
    this.stopGpuStream();
  }

  // ---------- Carte graphique ----------

  private startGpuStream(): void {
    if (this.gpuStream || this.gpuStreamFailed || this.game) return;
    try {
      const child = spawn("nvidia-smi", [NVIDIA_QUERY, "--format=csv,noheader,nounits", "-lms", "1000"], { windowsHide: true });
      this.gpuStream = child;
      let buffer = "";
      child.stdout.on("data", (d: Buffer) => {
        buffer += d.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        const readings = lines.map(parseNvidiaLine).filter((g): g is GpuReading => Boolean(g));
        if (readings.length) {
          this.gpu = readings.slice(-Math.max(1, this.gpu.length || 1));
          this.gpuAt = Date.now();
        }
      });
      child.on("error", () => {
        this.gpuStreamFailed = true;
        this.gpuStream = undefined;
      });
      child.on("exit", () => (this.gpuStream = undefined));
    } catch {
      this.gpuStreamFailed = true;
    }
  }

  private stopGpuStream(): void {
    this.gpuStream?.kill();
    this.gpuStream = undefined;
  }

  /** Sans flux continu : une seule lecture courte (nvidia-smi), ou systeminformation pour les autres cartes. */
  private async readGpuOnce(): Promise<void> {
    const viaNvidia = await new Promise<GpuReading[] | undefined>((resolve) =>
      execFile("nvidia-smi", [NVIDIA_QUERY, "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 8_000 }, (error, stdout) => {
        if (error) return resolve(undefined);
        resolve(String(stdout).split(/\r?\n/).map(parseNvidiaLine).filter((g): g is GpuReading => Boolean(g)));
      }),
    );
    if (viaNvidia?.length) {
      this.gpu = viaNvidia;
    } else {
      const graphics = await si.graphics().catch(() => ({ controllers: [] as si.Systeminformation.GraphicsControllerData[] }));
      this.gpu = graphics.controllers
        .filter((g) => g.vram === undefined || (g.vram ?? 0) > 256)
        .map((g) => ({
          modele: g.model,
          ...(g.utilizationGpu !== undefined && g.utilizationGpu !== null ? { chargePct: g.utilizationGpu } : {}),
          ...(g.memoryUsed ? { memoireUtiliseeGo: round(g.memoryUsed / 1024)! } : {}),
          ...(g.memoryTotal ? { memoireTotaleGo: round(g.memoryTotal / 1024)! } : {}),
          ...(g.temperatureGpu ? { temperatureC: g.temperatureGpu } : {}),
          ...(g.fanSpeed ? { ventilateurPct: g.fanSpeed } : {}),
          ...(g.powerDraw ? { puissanceW: round(g.powerDraw)! } : {}),
        }));
    }
    this.gpuAt = Date.now();
  }

  // ---------- Mesures lentes (jamais bloquantes) ----------

  private due(key: string, everyMs: number): boolean {
    const now = Date.now();
    if (now - (this.last[key] ?? 0) < everyMs) return false;
    this.last[key] = now;
    return true;
  }

  private async refreshSlow(): Promise<void> {
    if (this.slowBusy) return;
    this.slowBusy = true;
    try {
      const jobs: Array<Promise<unknown>> = [];
      if (!this.gpuStream && this.due("gpu", this.detailedMode ? 3_000 : 10_000)) jobs.push(this.readGpuOnce());
      if (this.due("reseau", this.detailedMode ? 3_000 : 10_000)) {
        jobs.push(
          si.networkStats().then((net) => {
            this.slow.reseau = {
              recuMbps: round((net.reduce((a, n) => a + Math.max(0, n.rx_sec ?? 0), 0) * 8) / 1e6) ?? 0,
              envoyeMbps: round((net.reduce((a, n) => a + Math.max(0, n.tx_sec ?? 0), 0) * 8) / 1e6) ?? 0,
            };
          }, () => undefined),
        );
      }
      if (this.due("disques", 60_000)) {
        jobs.push(
          si.fsSize().then((fs) => {
            this.slow.disques = fs.filter((d) => d.size > 0).map((d) => ({ lecteur: d.mount || d.fs, utilisePct: Math.round(d.use), libreGo: Math.round((d.size - d.used) / GB) }));
          }, () => undefined),
        );
      }
      // La liste des programmes est la mesure la plus coûteuse sous Windows : toutes les 10 s page ouverte, sinon toutes les 2 min.
      if (this.due("processus", this.detailedMode ? 10_000 : 120_000)) {
        jobs.push(
          si.processes().then((procs) => {
            this.slow.processus = [...procs.list]
              .sort((a, b) => b.cpu - a.cpu)
              .slice(0, 6)
              .map((p) => ({ nom: p.name, cpuPct: round(p.cpu) ?? 0, memoireMo: Math.round((p.memRss ?? 0) / 1024) }));
          }, () => undefined),
        );
      }
      // Température : Windows ne la donne souvent pas ; après 3 essais vides, on arrête de demander.
      if (this.slow.temperatureMisses < 3 && this.due("temperature", 60_000)) {
        jobs.push(
          si.cpuTemperature().then((t) => {
            if (t.main) {
              this.slow.temperatureC = round(t.main);
              this.slow.temperatureMisses = 0;
            } else this.slow.temperatureMisses += 1;
          }, () => (this.slow.temperatureMisses += 1)),
        );
      }
      if (this.due("frequence", 30_000)) {
        jobs.push(
          si.cpuCurrentSpeed().then((speed) => {
            if (speed.avg) this.slow.frequenceGHz = round(speed.avg, 2);
          }, () => undefined),
        );
      }
      await Promise.all(jobs);
    } finally {
      this.slowBusy = false;
    }
  }

  // ---------- Mesure rapide ----------

  async sample(): Promise<PerfSnapshot | undefined> {
    try {
      const times = os.cpus().map((c) => c.times);
      const load = cpuLoad(this.cpuTimes, times);
      this.cpuTimes = times;
      const total = os.totalmem();
      const free = os.freemem();
      // Les mesures lentes se mettent à jour en arrière-plan ; la première fois, on les attend une fois.
      const slow = this.refreshSlow();
      if (!this.latest) await slow;
      const base: Omit<PerfSnapshot, "alertes"> = {
        instant: new Date().toISOString(),
        cpu: {
          modele: this.slow.modele,
          chargePct: load.total,
          coeurs: load.coeurs,
          ...(this.slow.temperatureC !== undefined ? { temperatureC: this.slow.temperatureC } : {}),
          ...(this.slow.frequenceGHz !== undefined ? { frequenceGHz: this.slow.frequenceGHz } : {}),
        },
        memoire: { utiliseeGo: round((total - free) / GB)!, totaleGo: round(total / GB)!, pct: round(((total - free) / total) * 100)! },
        gpu: this.gpu,
        disques: this.slow.disques,
        reseau: this.slow.reseau,
        processus: this.slow.processus,
      };
      this.latest = { ...base, alertes: perfAlerts(base) };
      this.onSample(this.latest);
      return this.latest;
    } catch (error) {
      console.warn("[perf]", error);
      return this.latest;
    }
  }
}
