import { execFile } from "node:child_process";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";
import { runPowerShell } from "./pc.js";

/**
 * Santé du PC : Jarvis lit ce que Windows garde (arrêts brutaux, écrans bleus,
 * erreurs matérielles, plantages du pilote graphique), l'état de la carte
 * NVIDIA, de la mémoire et des disques, puis en tire un rapport avec des
 * causes probables et des actions (toujours sur demande, réversibles).
 */

export interface NvidiaReading {
  nom: string;
  pilote: string;
  tempC?: number;
  puissanceW?: number;
  limiteW?: number;
  limiteDefautW?: number;
  limiteMaxW?: number;
  ventilateurPct?: number;
  memoireUtiliseeMo?: number;
  memoireTotaleMo?: number;
  /** Raisons de bridage (code hexadécimal de nvidia-smi). */
  bridage?: string;
}

export interface HealthRaw {
  windows?: string;
  demarrageLe?: string;
  carteMere?: string;
  bios?: { version?: string; date?: string };
  arretsBrutaux: Array<{ date: string; bugcheck: number }>;
  arretsInattendus: string[];
  erreursMaterielles: Array<{ date: string; message: string }>;
  plantagesPilote: string[];
  minidumps: Array<{ nom: string; date: string }>;
  planAlimentation?: { guid: string; nom: string };
  modeJeuWindows?: boolean | null;
  hags?: boolean | null;
  memoire: Array<{ capaciteGo: number; vitesse?: number; configuree?: number }>;
  disques: Array<{ nom: string; sante: string; type: string; tailleGo: number }>;
  libreSystemePct?: number;
  programmesDemarrage: string[];
  nvidia?: NvidiaReading;
  /** Relevés de la carte graphique pendant les dernières parties (enregistrés par Jarvis). */
  relevesJeu: GameSample[];
}

export interface GameSample {
  instant: string;
  tempC?: number;
  puissanceW?: number;
  limiteW?: number;
  ventilateurPct?: number;
}

export type Severity = "critique" | "attention" | "info" | "ok";

export interface Finding {
  id: string;
  gravite: Severity;
  titre: string;
  detail: string;
  conseil?: string;
  actions?: Array<{ id: HealthActionId; libelle: string }>;
}

export const HEALTH_ACTIONS = {
  "plan-performances": "Passer en plan « Performances élevées »",
  "plan-equilibre": "Revenir au plan « Utilisation normale »",
  "limite-gpu": "Tester : limiter la carte graphique à 80 %",
  "limite-gpu-defaut": "Rendre toute sa puissance à la carte graphique",
  "nettoyer-temp": "Nettoyer les fichiers temporaires",
  "ouvrir-mode-jeu": "Ouvrir le mode jeu de Windows",
  "ouvrir-graphiques": "Ouvrir les réglages graphiques de Windows",
  "ouvrir-demarrage": "Ouvrir les applications au démarrage",
  "ouvrir-observateur": "Ouvrir l'Observateur d'événements",
  "pilote-nvidia": "Page des pilotes NVIDIA",
} as const;
export type HealthActionId = keyof typeof HEALTH_ACTIONS;

const HIGH_PERFORMANCE = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
const BALANCED = "381b4222-f694-41f0-9685-ff5bb260df2e";

// ---------- Collecte ----------

const COLLECT_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$since = (Get-Date).AddDays(-30)
$os = Get-CimInstance Win32_OperatingSystem
$bios = Get-CimInstance Win32_BIOS
$board = Get-CimInstance Win32_BaseBoard
$kp = @(Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-Kernel-Power'; Id=41; StartTime=$since} -MaxEvents 30 | ForEach-Object { [pscustomobject]@{ date = $_.TimeCreated.ToString('o'); bugcheck = [int64]$_.Properties[0].Value } })
$unexpected = @(Get-WinEvent -FilterHashtable @{LogName='System'; Id=6008; StartTime=$since} -MaxEvents 30 | ForEach-Object { $_.TimeCreated.ToString('o') })
$whea = @(Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-WHEA-Logger'; StartTime=$since} -MaxEvents 30 | ForEach-Object { [pscustomobject]@{ date = $_.TimeCreated.ToString('o'); message = ($_.Message -split "\\r?\\n")[0] } })
$drv = @(Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='nvlddmkm'; StartTime=$since} -MaxEvents 30 | ForEach-Object { $_.TimeCreated.ToString('o') })
$drv += @(Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Display'; Id=4101; StartTime=$since} -MaxEvents 30 | ForEach-Object { $_.TimeCreated.ToString('o') })
$dumps = @(Get-ChildItem "$env:SystemRoot\\Minidump\\*.dmp" | Sort-Object LastWriteTime -Descending | Select-Object -First 10 | ForEach-Object { [pscustomobject]@{ nom = $_.Name; date = $_.LastWriteTime.ToString('o') } })
$plan = (powercfg /getactivescheme) -join ' '
$gm = (Get-ItemProperty 'HKCU:\\Software\\Microsoft\\GameBar').AutoGameModeEnabled
$hags = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers').HwSchMode
$mem = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { [pscustomobject]@{ capaciteGo = [math]::Round($_.Capacity / 1GB); vitesse = $_.Speed; configuree = $_.ConfiguredClockSpeed } })
$disks = @(Get-PhysicalDisk | ForEach-Object { [pscustomobject]@{ nom = $_.FriendlyName; sante = [string]$_.HealthStatus; type = [string]$_.MediaType; tailleGo = [math]::Round($_.Size / 1GB) } })
$c = Get-PSDrive C
$free = if ($c) { [math]::Round(100 * $c.Free / ($c.Free + $c.Used)) } else { $null }
$startup = @(Get-CimInstance Win32_StartupCommand | Select-Object -ExpandProperty Name -Unique)
[pscustomobject]@{
  windows = "$($os.Caption) $($os.Version)"
  demarrageLe = if ($os.LastBootUpTime) { $os.LastBootUpTime.ToString('o') } else { $null }
  carteMere = "$($board.Manufacturer) $($board.Product)".Trim()
  bios = [pscustomobject]@{ version = $bios.SMBIOSBIOSVersion; date = if ($bios.ReleaseDate) { $bios.ReleaseDate.ToString('yyyy-MM-dd') } else { $null } }
  arretsBrutaux = $kp
  arretsInattendus = $unexpected
  erreursMaterielles = $whea
  plantagesPilote = $drv
  minidumps = $dumps
  plan = $plan
  modeJeuWindows = $gm
  hags = $hags
  memoire = $mem
  disques = $disks
  libreSystemePct = $free
  programmesDemarrage = $startup
} | ConvertTo-Json -Depth 5 -Compress
`;

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Lit la sortie JSON du script PowerShell (tolère les champs absents). */
export function parseCollect(json: string): Omit<HealthRaw, "nvidia" | "relevesJeu"> {
  const d = JSON.parse(json) as Record<string, unknown>;
  const plan = String(d.plan ?? "").match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*\(([^)]*)\)/i);
  const hags = d.hags === null || d.hags === undefined ? null : Number(d.hags) === 2;
  const gm = d.modeJeuWindows === null || d.modeJeuWindows === undefined ? null : Number(d.modeJeuWindows) === 1;
  return {
    ...(d.windows ? { windows: String(d.windows).trim() } : {}),
    ...(d.demarrageLe ? { demarrageLe: String(d.demarrageLe) } : {}),
    ...(d.carteMere ? { carteMere: String(d.carteMere) } : {}),
    ...(d.bios ? { bios: d.bios as HealthRaw["bios"] } : {}),
    arretsBrutaux: asArray(d.arretsBrutaux as HealthRaw["arretsBrutaux"]),
    arretsInattendus: asArray(d.arretsInattendus as string[]),
    erreursMaterielles: asArray(d.erreursMaterielles as HealthRaw["erreursMaterielles"]),
    plantagesPilote: asArray(d.plantagesPilote as string[]),
    minidumps: asArray(d.minidumps as HealthRaw["minidumps"]),
    ...(plan ? { planAlimentation: { guid: plan[1]!.toLowerCase(), nom: plan[2]!.trim() } } : {}),
    modeJeuWindows: gm,
    hags,
    memoire: asArray(d.memoire as HealthRaw["memoire"]),
    disques: asArray(d.disques as HealthRaw["disques"]),
    ...(typeof d.libreSystemePct === "number" ? { libreSystemePct: d.libreSystemePct } : {}),
    programmesDemarrage: asArray(d.programmesDemarrage as string[]),
  };
}

const NVIDIA_FIELDS = ["name", "driver_version", "temperature.gpu", "power.draw", "power.limit", "power.default_limit", "power.max_limit", "fan.speed", "memory.used", "memory.total"];

function execText(file: string, args: string[], timeoutMs = 10_000): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs }, (error, stdout) => resolve({ code: error ? 1 : 0, stdout: String(stdout ?? "") }));
  });
}

/** Une ligne CSV de nvidia-smi → relevé. */
export function parseNvidia(csv: string, bridage?: string): NvidiaReading | undefined {
  const line = csv.split(/\r?\n/).find((l) => l.trim());
  if (!line) return undefined;
  const v = line.split(",").map((x) => x.trim());
  const num = (i: number) => {
    const n = Number(v[i]);
    return Number.isFinite(n) ? n : undefined;
  };
  const reading: NvidiaReading = { nom: v[0] ?? "NVIDIA", pilote: v[1] ?? "" };
  const set = <K extends keyof NvidiaReading>(k: K, value: NvidiaReading[K] | undefined) => value !== undefined && (reading[k] = value);
  set("tempC", num(2));
  set("puissanceW", num(3));
  set("limiteW", num(4));
  set("limiteDefautW", num(5));
  set("limiteMaxW", num(6));
  set("ventilateurPct", num(7));
  set("memoireUtiliseeMo", num(8));
  set("memoireTotaleMo", num(9));
  if (bridage) reading.bridage = bridage;
  return reading;
}

export async function readNvidia(): Promise<NvidiaReading | undefined> {
  const main = await execText("nvidia-smi", [`--query-gpu=${NVIDIA_FIELDS.join(",")}`, "--format=csv,noheader,nounits"]);
  if (main.code !== 0) return undefined;
  // Raisons de bridage : le nom du champ a changé selon les versions du pilote.
  let reasons = await execText("nvidia-smi", ["--query-gpu=clocks_event_reasons.active", "--format=csv,noheader"]);
  if (reasons.code !== 0) reasons = await execText("nvidia-smi", ["--query-gpu=clocks_throttle_reasons.active", "--format=csv,noheader"]);
  return parseNvidia(main.stdout, reasons.code === 0 ? reasons.stdout.trim() : undefined);
}

// ---------- Relevés pendant les parties ----------

/**
 * Pendant un jeu, Jarvis note la température et la puissance de la carte
 * graphique toutes les 15 s, écrites sur le disque immédiatement : après un
 * arrêt brutal, on sait dans quel état était la carte juste avant.
 */
export class GameRecorder {
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly dir: string, private readonly read: () => Promise<NvidiaReading | undefined> = readNvidia) {}

  private file(date = new Date()): string {
    return path.join(this.dir, `jeu-${date.toISOString().slice(0, 10)}.csv`);
  }

  start(intervalMs = 15_000): void {
    if (this.timer) return;
    mkdirSync(this.dir, { recursive: true });
    const tick = async () => {
      const r = await this.read().catch(() => undefined);
      if (r) this.write(r);
    };
    void tick();
    this.timer = setInterval(() => void tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  write(r: NvidiaReading, at = new Date()): void {
    const file = this.file(at);
    const fresh = !existsSync(file);
    const fd = openSync(file, "a");
    try {
      if (fresh) writeSync(fd, "instant,temperature_c,puissance_w,limite_w,ventilateur_pct\n");
      writeSync(fd, `${at.toISOString()},${r.tempC ?? ""},${r.puissanceW ?? ""},${r.limiteW ?? ""},${r.ventilateurPct ?? ""}\n`);
      // Écrit vraiment sur le disque : une coupure de courant ne doit pas effacer les derniers relevés.
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /** Relevés des derniers jours (les plus récents à la fin). */
  recent(days = 30): GameSample[] {
    if (!existsSync(this.dir)) return [];
    const limit = Date.now() - days * 86_400_000;
    const files = readdirSync(this.dir).filter((n) => /^jeu-\d{4}-\d{2}-\d{2}\.csv$/.test(n)).sort();
    const out: GameSample[] = [];
    for (const name of files) {
      if (new Date(`${name.slice(4, 14)}T23:59:59Z`).getTime() < limit) continue;
      for (const line of readFileSync(path.join(this.dir, name), "utf8").split(/\r?\n/).slice(1)) {
        const [instant, t, p, l, f] = line.split(",");
        if (!instant) continue;
        const n = (x?: string) => (x && Number.isFinite(Number(x)) ? Number(x) : undefined);
        out.push({ instant, ...(n(t) !== undefined ? { tempC: n(t)! } : {}), ...(n(p) !== undefined ? { puissanceW: n(p)! } : {}), ...(n(l) !== undefined ? { limiteW: n(l)! } : {}), ...(n(f) !== undefined ? { ventilateurPct: n(f)! } : {}) });
      }
    }
    return out;
  }
}

export async function collectHealth(recorder: GameRecorder): Promise<HealthRaw> {
  const [ps, nvidia] = await Promise.all([runPowerShell(COLLECT_SCRIPT, 90_000), readNvidia()]);
  let base: Omit<HealthRaw, "nvidia" | "relevesJeu">;
  try {
    base = parseCollect(ps.stdout.slice(ps.stdout.indexOf("{")));
  } catch {
    base = { arretsBrutaux: [], arretsInattendus: [], erreursMaterielles: [], plantagesPilote: [], minidumps: [], memoire: [], disques: [], programmesDemarrage: [] };
  }
  return { ...base, ...(nvidia ? { nvidia } : {}), relevesJeu: recorder.recent() };
}

// ---------- Analyse ----------

const fmtDate = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Derniers relevés de la carte graphique dans les 5 minutes avant un instant. */
export function samplesBefore(samples: GameSample[], iso: string, windowMs = 5 * 60_000): GameSample[] {
  const t = new Date(iso).getTime();
  return samples.filter((s) => {
    const st = new Date(s.instant).getTime();
    return st <= t && t - st <= windowMs;
  });
}

export function analyzeHealth(raw: HealthRaw, context: { alimentation?: string | undefined } = {}): Finding[] {
  const findings: Finding[] = [];
  const powerCuts = raw.arretsBrutaux.filter((e) => e.bugcheck === 0);
  const blueScreens = raw.arretsBrutaux.filter((e) => e.bugcheck !== 0);

  if (powerCuts.length) {
    // Que faisait la carte graphique juste avant ?
    const before = powerCuts.map((cut) => ({ cut, samples: samplesBefore(raw.relevesJeu, cut.date) })).find((x) => x.samples.length);
    const last = before?.samples.at(-1);
    const hot = Boolean(last?.tempC && last.tempC >= 83);
    const nearLimit = Boolean(last?.puissanceW && last.limiteW && last.puissanceW >= last.limiteW * 0.9);
    const lastText = last ? ` Juste avant l'arrêt du ${fmtDate(before!.cut.date)} : carte graphique à ${last.tempC ?? "?"} °C, ${last.puissanceW ?? "?"} W sur ${last.limiteW ?? "?"} W.` : " Jarvis enregistre désormais la carte graphique pendant tes parties : au prochain arrêt, on saura dans quel état elle était.";
    findings.push({
      id: "arrets-brutaux",
      gravite: "critique",
      titre: `${powerCuts.length} arrêt${powerCuts.length > 1 ? "s" : ""} brutal${powerCuts.length > 1 ? "aux" : ""} en 30 jours`,
      detail: `Le PC s'est éteint d'un coup, sans écran bleu (dernier : ${fmtDate(powerCuts[0]!.date)}). Windows n'a pas eu le temps de s'arrêter : le courant a été coupé.${lastText}`,
      conseil: hot
        ? "La carte graphique était très chaude : nettoie la poussière (ventilateurs, filtres), vérifie que le boîtier aspire de l'air frais, et teste la limite à 80 %."
        : `Cause la plus fréquente avec une RTX 3070 : l'alimentation ne tient pas ses pics de consommation (brefs pics bien au-dessus de 220 W). NVIDIA conseille 650 W de bonne qualité.${context.alimentation ? ` Ton alimentation : ${context.alimentation}.` : " Note le modèle de ton alimentation dans les Réglages (étiquette sur le côté du bloc)."} Test simple : limite la carte à 80 % ; si les arrêts cessent, c'est l'alimentation. Branche aussi le PC directement au mur (pas de multiprise fatiguée).${nearLimit ? " La carte était à sa puissance maximale juste avant l'arrêt." : ""}`,
      actions: [{ id: "limite-gpu", libelle: HEALTH_ACTIONS["limite-gpu"] }],
    });
  }

  if (blueScreens.length || raw.minidumps.length) {
    const codes = [...new Set(blueScreens.map((b) => `0x${b.bugcheck.toString(16).toUpperCase()}`))];
    findings.push({
      id: "ecrans-bleus",
      gravite: "critique",
      titre: `Écran${blueScreens.length > 1 ? "s" : ""} bleu${blueScreens.length > 1 ? "s" : ""}`,
      detail: `${blueScreens.length || raw.minidumps.length} plantage(s) de Windows${codes.length ? ` (code ${codes.join(", ")})` : ""}${raw.minidumps[0] ? `, dernier rapport ${raw.minidumps[0].nom}` : ""}.`,
      conseil: "Le code dit d'où vient le plantage : « Chercher des solutions sur Internet » l'interprète pour ton matériel.",
      actions: [{ id: "ouvrir-observateur", libelle: HEALTH_ACTIONS["ouvrir-observateur"] }],
    });
  }

  if (raw.erreursMaterielles.length) {
    findings.push({
      id: "whea",
      gravite: "attention",
      titre: `${raw.erreursMaterielles.length} erreur(s) matérielle(s) signalée(s)`,
      detail: `Le processeur ou la mémoire ont signalé des erreurs (WHEA), dernière le ${fmtDate(raw.erreursMaterielles[0]!.date)} : ${raw.erreursMaterielles[0]!.message}`,
      conseil: "Souvent une mémoire ou un processeur poussés trop loin : si tu as activé XMP/EXPO, PBO ou un « Curve Optimizer », remets-les par défaut dans le BIOS pour tester. Mettre à jour le BIOS aide aussi beaucoup sur les Ryzen 5000.",
    });
  }

  if (raw.plantagesPilote.length) {
    findings.push({
      id: "pilote",
      gravite: "attention",
      titre: `Le pilote graphique a planté ${raw.plantagesPilote.length} fois`,
      detail: `Windows a dû relancer le pilote NVIDIA (dernier : ${fmtDate(raw.plantagesPilote.sort().at(-1)!)}).`,
      conseil: "Installe le dernier pilote « Game Ready » en choisissant « Installation personnalisée → nouvelle installation ». Si ça continue, c'est souvent l'alimentation ou la chaleur.",
      actions: [{ id: "pilote-nvidia", libelle: HEALTH_ACTIONS["pilote-nvidia"] }],
    });
  }

  const gpu = raw.nvidia;
  if (gpu?.tempC !== undefined && gpu.tempC >= 83) findings.push({ id: "gpu-chaud", gravite: "attention", titre: `Carte graphique chaude (${gpu.tempC} °C)`, detail: "Au-delà de 83 °C, une RTX baisse ses fréquences ; près de 90 °C, le PC peut se couper.", conseil: "Dépoussière, vérifie les ventilateurs du boîtier, et teste la limite à 80 %.", actions: [{ id: "limite-gpu", libelle: HEALTH_ACTIONS["limite-gpu"] }] });
  if (gpu?.limiteW && gpu.limiteDefautW && gpu.limiteW < gpu.limiteDefautW - 1) findings.push({ id: "gpu-limite", gravite: "info", titre: `Carte graphique limitée à ${Math.round(gpu.limiteW)} W`, detail: `Sa puissance normale est ${Math.round(gpu.limiteDefautW)} W. La limite disparaît au redémarrage du PC.`, actions: [{ id: "limite-gpu-defaut", libelle: HEALTH_ACTIONS["limite-gpu-defaut"] }] });

  const highest = raw.relevesJeu.reduce((m, s) => Math.max(m, s.tempC ?? 0), 0);
  if (highest >= 83 && !findings.some((f) => f.id === "gpu-chaud")) findings.push({ id: "gpu-chaud-jeu", gravite: "attention", titre: `Carte graphique jusqu'à ${highest} °C en jeu`, detail: "Relevé pendant tes parties des 30 derniers jours.", conseil: "Dépoussière et améliore l'aération du boîtier.", actions: [{ id: "limite-gpu", libelle: HEALTH_ACTIONS["limite-gpu"] }] });

  if (raw.planAlimentation && raw.planAlimentation.guid !== HIGH_PERFORMANCE && !/ultimate|optimales|performances/i.test(raw.planAlimentation.nom)) {
    findings.push({ id: "plan", gravite: "info", titre: `Plan d'alimentation : ${raw.planAlimentation.nom}`, detail: "Le plan « Performances élevées » garde le processeur prêt : un peu plus de fluidité en jeu, un peu plus de consommation au repos.", actions: [{ id: "plan-performances", libelle: HEALTH_ACTIONS["plan-performances"] }] });
  }
  if (raw.modeJeuWindows === false) findings.push({ id: "mode-jeu", gravite: "info", titre: "Mode jeu de Windows désactivé", detail: "Il donne la priorité au jeu et bloque les mises à jour pendant les parties.", actions: [{ id: "ouvrir-mode-jeu", libelle: HEALTH_ACTIONS["ouvrir-mode-jeu"] }] });
  if (raw.hags === false) findings.push({ id: "hags", gravite: "info", titre: "Planification GPU accélérée désactivée", detail: "Sur une RTX, l'activer réduit un peu la latence (et elle est nécessaire à la génération d'images DLSS 3).", actions: [{ id: "ouvrir-graphiques", libelle: HEALTH_ACTIONS["ouvrir-graphiques"] }] });

  const slowRam = raw.memoire.filter((m) => m.vitesse && m.configuree && m.configuree < m.vitesse - 100);
  if (slowRam.length) {
    findings.push({ id: "xmp", gravite: "info", titre: `Mémoire à ${slowRam[0]!.configuree} MHz au lieu de ${slowRam[0]!.vitesse} MHz`, detail: "Le profil XMP/DOCP de la mémoire n'est pas activé dans le BIOS. Les Ryzen « G » (puce graphique comprise) gagnent nettement avec une mémoire rapide.", conseil: "À activer seulement une fois les arrêts brutaux réglés : une mémoire plus rapide ajoute un peu de risque d'instabilité." });
  }
  const totalRam = raw.memoire.reduce((a, m) => a + m.capaciteGo, 0);
  if (totalRam && totalRam <= 16) findings.push({ id: "ram", gravite: "info", titre: `${totalRam} Go de mémoire`, detail: "Suffisant, mais un jeu de simulation récent avec Jarvis, un navigateur et Discord en même temps approche de la limite. 32 Go donneraient de la marge." });

  for (const disk of raw.disques.filter((d) => d.sante && !/healthy|sain|ok/i.test(d.sante))) {
    findings.push({ id: `disque-${disk.nom}`, gravite: "critique", titre: `Disque ${disk.nom} : ${disk.sante}`, detail: "Windows signale un disque en mauvaise santé.", conseil: "Sauvegarde tes données importantes dès maintenant." });
  }
  if (raw.libreSystemePct !== undefined && raw.libreSystemePct < 10) findings.push({ id: "disque-plein", gravite: "attention", titre: `Disque C: presque plein (${raw.libreSystemePct} % libres)`, detail: "Windows et les jeux ralentissent quand le disque système est plein.", actions: [{ id: "nettoyer-temp", libelle: HEALTH_ACTIONS["nettoyer-temp"] }] });
  if (raw.programmesDemarrage.length > 12) findings.push({ id: "demarrage", gravite: "info", titre: `${raw.programmesDemarrage.length} programmes au démarrage`, detail: `Dont : ${raw.programmesDemarrage.slice(0, 8).join(", ")}…`, conseil: "Désactive ceux dont tu n'as pas besoin en permanence.", actions: [{ id: "ouvrir-demarrage", libelle: HEALTH_ACTIONS["ouvrir-demarrage"] }] });

  if (raw.bios?.date) {
    const ageYears = (Date.now() - new Date(raw.bios.date).getTime()) / (365 * 86_400_000);
    if (ageYears > 2) findings.push({ id: "bios", gravite: "info", titre: `BIOS de ${raw.bios.date.slice(0, 4)}`, detail: `Version ${raw.bios.version ?? "?"} (${raw.carteMere ?? "carte mère"}). Les mises à jour récentes corrigent souvent la stabilité des Ryzen 5000.`, conseil: "Mets-le à jour depuis le site du fabricant de la carte mère (sans coupure de courant pendant la mise à jour)." });
  }

  if (!findings.some((f) => f.gravite === "critique" || f.gravite === "attention")) findings.unshift({ id: "ok", gravite: "ok", titre: "Rien d'inquiétant", detail: "Aucun arrêt brutal, écran bleu ni erreur matérielle sur 30 jours." });
  const order: Record<Severity, number> = { ok: -1, critique: 0, attention: 1, info: 2 };
  return findings.sort((a, b) => order[a.gravite] - order[b.gravite]);
}

// ---------- Rapport ----------

export function healthReport(raw: HealthRaw, findings: Finding[], extra: { machine?: string; analyseWeb?: string } = {}): string {
  const lines = [`# Santé du PC — ${new Date().toLocaleString("fr-FR")}`, ""];
  if (extra.machine) lines.push(`**Machine** : ${extra.machine}`);
  if (raw.windows) lines.push(`**Windows** : ${raw.windows}`);
  if (raw.carteMere) lines.push(`**Carte mère** : ${raw.carteMere}${raw.bios?.version ? `, BIOS ${raw.bios.version} (${raw.bios.date ?? "?"})` : ""}`);
  if (raw.nvidia) lines.push(`**Carte graphique** : ${raw.nvidia.nom}, pilote ${raw.nvidia.pilote}, ${raw.nvidia.tempC ?? "?"} °C, ${raw.nvidia.puissanceW ?? "?"} W / ${raw.nvidia.limiteW ?? "?"} W`);
  lines.push("", "## Constats", "");
  for (const f of findings) lines.push(`- **[${f.gravite}] ${f.titre}** — ${f.detail}${f.conseil ? `\n  - À faire : ${f.conseil}` : ""}`);
  lines.push("", "## Arrêts des 30 derniers jours", "");
  if (!raw.arretsBrutaux.length) lines.push("Aucun.");
  for (const a of raw.arretsBrutaux) lines.push(`- ${fmtDate(a.date)} : ${a.bugcheck === 0 ? "coupure brutale (pas d'écran bleu)" : `écran bleu 0x${a.bugcheck.toString(16).toUpperCase()}`}`);
  if (extra.analyseWeb) lines.push("", "## Recherche sur Internet", "", extra.analyseWeb);
  return lines.join("\n");
}

/** Version courte et sans données personnelles, pour la recherche en ligne. */
export function healthSummaryForWeb(raw: HealthRaw, findings: Finding[], machine: string, alimentation?: string): string {
  return JSON.stringify({
    machine,
    alimentation: alimentation ?? "inconnue",
    windows: raw.windows,
    carteMere: raw.carteMere,
    bios: raw.bios,
    carteGraphique: raw.nvidia ? { modele: raw.nvidia.nom, pilote: raw.nvidia.pilote, tempC: raw.nvidia.tempC, puissanceW: raw.nvidia.puissanceW, limiteW: raw.nvidia.limiteW, limiteDefautW: raw.nvidia.limiteDefautW } : undefined,
    memoire: raw.memoire,
    arretsBrutaux30j: raw.arretsBrutaux.map((a) => ({ date: a.date, codeEcranBleu: a.bugcheck ? `0x${a.bugcheck.toString(16)}` : null })),
    erreursMaterielles: raw.erreursMaterielles.slice(0, 5).map((e) => e.message),
    plantagesPilote30j: raw.plantagesPilote.length,
    temperatureMaxEnJeu: raw.relevesJeu.reduce((m, s) => Math.max(m, s.tempC ?? 0), 0) || undefined,
    planAlimentation: raw.planAlimentation?.nom,
    constats: findings.map((f) => `${f.gravite} : ${f.titre}`),
  });
}

// ---------- Actions (toujours sur demande d'Alex) ----------

export async function runHealthAction(id: HealthActionId, nvidia: NvidiaReading | undefined, open: (url: string) => void): Promise<string> {
  switch (id) {
    case "plan-performances": {
      const r = await execText("powercfg", ["/setactive", HIGH_PERFORMANCE]);
      return r.code === 0 ? "Plan « Performances élevées » activé. Pour revenir en arrière : « Revenir au plan Utilisation normale »." : "Ce PC n'a pas le plan « Performances élevées » (Windows le masque parfois) : Paramètres → Système → Alimentation → Mode d'alimentation → Performances optimales.";
    }
    case "plan-equilibre": {
      const r = await execText("powercfg", ["/setactive", BALANCED]);
      return r.code === 0 ? "Plan « Utilisation normale » rétabli." : "Impossible de changer de plan.";
    }
    case "limite-gpu":
    case "limite-gpu-defaut": {
      if (!nvidia?.limiteDefautW) return "Carte NVIDIA introuvable (nvidia-smi ne répond pas).";
      const watts = id === "limite-gpu" ? Math.round(nvidia.limiteDefautW * 0.8) : Math.round(nvidia.limiteDefautW);
      // Demande l'autorisation administrateur (fenêtre de Windows) ; la limite s'efface au redémarrage du PC.
      const r = await runPowerShell(`$p = Start-Process -FilePath 'nvidia-smi' -ArgumentList '-pl','${watts}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`, 120_000);
      if (r.code !== 0) return "Limite non appliquée (autorisation refusée ou carte non compatible).";
      return id === "limite-gpu"
        ? `Carte graphique limitée à ${watts} W (au lieu de ${Math.round(nvidia.limiteDefautW)} W) jusqu'au prochain redémarrage du PC. Tu perds environ 5 % d'images par seconde. Joue comme d'habitude : si le PC ne s'éteint plus, l'alimentation est en cause.`
        : `Carte graphique remise à ${watts} W.`;
    }
    case "nettoyer-temp": {
      const r = await runPowerShell(`$t = 0; Get-ChildItem $env:TEMP -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-2) } | ForEach-Object { try { $s = $_.Length; Remove-Item $_.FullName -Force -ErrorAction Stop; $t += $s } catch {} }; [math]::Round($t / 1MB)`, 300_000);
      return `Fichiers temporaires nettoyés : ${r.stdout.trim() || "0"} Mo libérés (les fichiers en cours d'utilisation sont laissés).`;
    }
    case "ouvrir-mode-jeu":
      open("ms-settings:gaming-gamemode");
      return "Réglages du mode jeu ouverts : active « Mode jeu ».";
    case "ouvrir-graphiques":
      open("ms-settings:display-advancedgraphics");
      return "Réglages graphiques ouverts : active « Planification GPU accélérée par le matériel », puis redémarre le PC.";
    case "ouvrir-demarrage":
      open("ms-settings:startupapps");
      return "Applications au démarrage ouvertes : désactive celles dont tu n'as pas besoin.";
    case "ouvrir-observateur":
      await execText("cmd", ["/c", "start", "", "eventvwr.msc"]);
      return "Observateur d'événements ouvert (Journaux Windows → Système).";
    case "pilote-nvidia":
      open("https://www.nvidia.com/fr-fr/drivers/");
      return "Page des pilotes NVIDIA ouverte.";
  }
}
