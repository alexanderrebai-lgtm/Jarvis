import { execFile } from "node:child_process";
import { runPowerShell } from "./pc.js";

/**
 * Diagnostic détaillé par composant : processeur, carte graphique, mémoire,
 * disques, réseau, système. Chaque composant reçoit un état (bon, à surveiller,
 * problème) et des constats en français.
 */

export type ComponentState = "ok" | "attention" | "erreur" | "inconnu";

export interface ComponentReport {
  id: "processeur" | "carte-graphique" | "memoire" | "disques" | "reseau" | "systeme";
  titre: string;
  etat: ComponentState;
  mesures: Array<{ libelle: string; valeur: string; alerte?: boolean }>;
  constats: string[];
}

export interface ComponentsRaw {
  cpu?: { nom: string; coeurs: number; threads: number; frequenceMaxMhz?: number; frequenceMhz?: number; chargePct?: number };
  memoire?: { totaleMo: number; libreMo: number; engageeMo?: number; limiteEngagementMo?: number; fichierEchangeMo?: number; fichierEchangeUtiliseMo?: number; fichierEchangeAuto?: boolean; modules: Array<{ capaciteGo: number; vitesse?: number; configuree?: number; fabricant?: string }> };
  processus: Array<{ nom: string; id: number; memoireMo: number; cpuS?: number }>;
  disques: Array<{ nom: string; type: string; sante: string; tailleGo: number; temperatureC?: number; usurePct?: number; erreursLecture?: number }>;
  volumes: Array<{ lettre: string; nom?: string; tailleGo: number; libreGo: number }>;
  reseau: Array<{ nom: string; description: string; vitesse: string; type: string }>;
  systeme?: { windows: string; build?: string; demarrageLe?: string; joursAllume?: number };
  gpu?: GpuDetails;
}

export interface GpuDetails {
  nom: string;
  pilote: string;
  tempC?: number;
  chargePct?: number;
  chargeMemoirePct?: number;
  memoireUtiliseeMo?: number;
  memoireTotaleMo?: number;
  puissanceW?: number;
  limiteW?: number;
  frequenceMhz?: number;
  frequenceMaxMhz?: number;
  frequenceMemoireMhz?: number;
  frequenceMemoireMaxMhz?: number;
  ventilateurPct?: number;
  pcieGen?: number;
  pcieGenMax?: number;
  pcieLargeur?: number;
  pcieLargeurMax?: number;
  pstate?: string;
}

const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$pf = Get-CimInstance Win32_PageFileUsage | Select-Object -First 1
$mods = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { [pscustomobject]@{ capaciteGo = [math]::Round($_.Capacity / 1GB); vitesse = $_.Speed; configuree = $_.ConfiguredClockSpeed; fabricant = ([string]$_.Manufacturer).Trim() } })
$procs = @(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 | ForEach-Object { [pscustomobject]@{ nom = $_.ProcessName; id = $_.Id; memoireMo = [math]::Round($_.WorkingSet64 / 1MB); cpuS = [math]::Round($_.CPU) } })
$disks = @(Get-PhysicalDisk | ForEach-Object {
  $rc = $_ | Get-StorageReliabilityCounter
  [pscustomobject]@{ nom = $_.FriendlyName; type = [string]$_.MediaType; sante = [string]$_.HealthStatus; tailleGo = [math]::Round($_.Size / 1GB); temperatureC = $rc.Temperature; usurePct = $rc.Wear; erreursLecture = $rc.ReadErrorsUncorrected }
})
$vols = @(Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' -and $_.Size -gt 0 } | ForEach-Object { [pscustomobject]@{ lettre = [string]$_.DriveLetter; nom = $_.FileSystemLabel; tailleGo = [math]::Round($_.Size / 1GB); libreGo = [math]::Round($_.SizeRemaining / 1GB) } })
$net = @(Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | ForEach-Object { [pscustomobject]@{ nom = $_.Name; description = $_.InterfaceDescription; vitesse = [string]$_.LinkSpeed; type = [string]$_.MediaType } })
[pscustomobject]@{
  cpu = [pscustomobject]@{ nom = ([string]$cpu.Name).Trim(); coeurs = $cpu.NumberOfCores; threads = $cpu.NumberOfLogicalProcessors; frequenceMaxMhz = $cpu.MaxClockSpeed; frequenceMhz = $cpu.CurrentClockSpeed; chargePct = $cpu.LoadPercentage }
  memoire = [pscustomobject]@{ totaleMo = [math]::Round($os.TotalVisibleMemorySize / 1KB); libreMo = [math]::Round($os.FreePhysicalMemory / 1KB); engageeMo = [math]::Round(($os.TotalVirtualMemorySize - $os.FreeVirtualMemory) / 1KB); limiteEngagementMo = [math]::Round($os.TotalVirtualMemorySize / 1KB); fichierEchangeMo = $pf.AllocatedBaseSize; fichierEchangeUtiliseMo = $pf.CurrentUsage; fichierEchangeAuto = $cs.AutomaticManagedPagefile; modules = $mods }
  processus = $procs
  disques = $disks
  volumes = $vols
  reseau = $net
  systeme = [pscustomobject]@{ windows = "$($os.Caption)"; build = $os.BuildNumber; demarrageLe = if ($os.LastBootUpTime) { $os.LastBootUpTime.ToString('o') } else { $null }; joursAllume = if ($os.LastBootUpTime) { [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalDays, 1) } else { $null } }
} | ConvertTo-Json -Depth 5 -Compress
`;

const GPU_FIELDS = ["name", "driver_version", "temperature.gpu", "utilization.gpu", "utilization.memory", "memory.used", "memory.total", "power.draw", "power.limit", "clocks.gr", "clocks.max.gr", "clocks.mem", "clocks.max.mem", "fan.speed", "pcie.link.gen.current", "pcie.link.gen.max", "pcie.link.width.current", "pcie.link.width.max", "pstate"];

export function parseGpu(csv: string): GpuDetails | undefined {
  const line = csv.split(/\r?\n/).find((l) => l.trim());
  if (!line) return undefined;
  const v = line.split(",").map((x) => x.trim());
  const n = (i: number) => {
    const x = Number(v[i]);
    return Number.isFinite(x) ? x : undefined;
  };
  const g: GpuDetails = { nom: v[0] ?? "NVIDIA", pilote: v[1] ?? "" };
  const keys: Array<[keyof GpuDetails, number]> = [["tempC", 2], ["chargePct", 3], ["chargeMemoirePct", 4], ["memoireUtiliseeMo", 5], ["memoireTotaleMo", 6], ["puissanceW", 7], ["limiteW", 8], ["frequenceMhz", 9], ["frequenceMaxMhz", 10], ["frequenceMemoireMhz", 11], ["frequenceMemoireMaxMhz", 12], ["ventilateurPct", 13], ["pcieGen", 14], ["pcieGenMax", 15], ["pcieLargeur", 16], ["pcieLargeurMax", 17]];
  for (const [k, i] of keys) {
    const x = n(i);
    if (x !== undefined) (g as unknown as Record<string, number>)[k] = x;
  }
  if (v[18]) g.pstate = v[18];
  return g;
}

function readGpu(): Promise<GpuDetails | undefined> {
  return new Promise((resolve) => {
    execFile("nvidia-smi", [`--query-gpu=${GPU_FIELDS.join(",")}`, "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 10_000 }, (error, stdout) => resolve(error ? undefined : parseGpu(String(stdout))));
  });
}

const arr = <T,>(x: T | T[] | null | undefined): T[] => (x === null || x === undefined ? [] : Array.isArray(x) ? x : [x]);

export function parseComponents(json: string, gpu?: GpuDetails): ComponentsRaw {
  const d = JSON.parse(json || "{}") as Record<string, unknown>;
  type Memory = NonNullable<ComponentsRaw["memoire"]>;
  const mem = d.memoire as (Omit<Memory, "modules"> & { modules?: Memory["modules"] | Memory["modules"][number] }) | undefined;
  return {
    ...(d.cpu ? { cpu: d.cpu as ComponentsRaw["cpu"] } : {}),
    ...(mem ? { memoire: { ...mem, modules: arr(mem.modules) } } : {}),
    processus: arr(d.processus as ComponentsRaw["processus"]),
    disques: arr(d.disques as ComponentsRaw["disques"]),
    volumes: arr(d.volumes as ComponentsRaw["volumes"]),
    reseau: arr(d.reseau as ComponentsRaw["reseau"]),
    ...(d.systeme ? { systeme: d.systeme as ComponentsRaw["systeme"] } : {}),
    ...(gpu ? { gpu } : {}),
  };
}

export async function collectComponents(): Promise<ComponentsRaw> {
  const [ps, gpu] = await Promise.all([runPowerShell(SCRIPT, 90_000), readGpu()]);
  try {
    return parseComponents(ps.stdout.slice(ps.stdout.indexOf("{")), gpu);
  } catch {
    return { processus: [], disques: [], volumes: [], reseau: [], ...(gpu ? { gpu } : {}) };
  }
}

// ---------- Analyse ----------

const go = (mo: number) => `${(mo / 1024).toFixed(1).replace(".", ",")} Go`;
const worst = (states: ComponentState[]): ComponentState => (states.includes("erreur") ? "erreur" : states.includes("attention") ? "attention" : "ok");

export function analyzeComponents(raw: ComponentsRaw): ComponentReport[] {
  const reports: ComponentReport[] = [];

  // Processeur
  if (raw.cpu) {
    const c = raw.cpu;
    const states: ComponentState[] = ["ok"];
    const constats: string[] = [];
    if ((c.chargePct ?? 0) >= 90) {
      states.push("attention");
      constats.push("Processeur presque saturé en ce moment : regarde les programmes les plus gourmands.");
    }
    reports.push({
      id: "processeur",
      titre: "Processeur",
      etat: worst(states),
      mesures: [
        { libelle: "Modèle", valeur: c.nom },
        { libelle: "Cœurs / threads", valeur: `${c.coeurs} / ${c.threads}` },
        { libelle: "Charge", valeur: c.chargePct !== undefined ? `${c.chargePct} %` : "—", alerte: (c.chargePct ?? 0) >= 90 },
        { libelle: "Fréquence de base", valeur: c.frequenceMaxMhz ? `${(c.frequenceMaxMhz / 1000).toFixed(2).replace(".", ",")} GHz` : "—" },
      ],
      constats: constats.length ? constats : ["Rien d'anormal. (Windows ne donne pas la température du processeur sans outil dédié : HWiNFO la montre si besoin.)"],
    });
  }

  // Carte graphique
  if (raw.gpu) {
    const g = raw.gpu;
    const states: ComponentState[] = ["ok"];
    const constats: string[] = [];
    if ((g.tempC ?? 0) >= 83) {
      states.push("attention");
      constats.push(`${g.tempC} °C : la carte chauffe beaucoup (dépoussiérage, aération du boîtier, courbe des ventilateurs).`);
    }
    if (g.pcieLargeur && g.pcieLargeurMax && g.pcieLargeur < g.pcieLargeurMax) {
      states.push("attention");
      constats.push(`Liaison PCIe en x${g.pcieLargeur} au lieu de x${g.pcieLargeurMax} : la carte est peut-être dans le mauvais port, mal enfoncée, ou le port partage ses lignes avec un SSD. Le premier port PCIe (le plus proche du processeur) est le bon.`);
    }
    if (g.memoireTotaleMo && g.memoireUtiliseeMo && g.memoireUtiliseeMo / g.memoireTotaleMo > 0.9) {
      states.push("attention");
      constats.push("Mémoire vidéo presque pleine : en jeu, baisse la qualité des textures ou ferme ce qui l'utilise (navigateur, voix locale de Jarvis…).");
    }
    if (g.pcieGen && g.pcieGenMax && g.pcieGen < g.pcieGenMax && (g.chargePct ?? 0) < 30) constats.push(`PCIe en génération ${g.pcieGen} au repos (${g.pcieGenMax} maximum) : normal, la carte économise de l'énergie quand elle ne travaille pas.`);
    reports.push({
      id: "carte-graphique",
      titre: "Carte graphique",
      etat: worst(states),
      mesures: [
        { libelle: "Modèle", valeur: g.nom },
        { libelle: "Pilote", valeur: g.pilote },
        { libelle: "Température", valeur: g.tempC !== undefined ? `${g.tempC} °C` : "—", alerte: (g.tempC ?? 0) >= 83 },
        { libelle: "Charge", valeur: g.chargePct !== undefined ? `${g.chargePct} %` : "—" },
        { libelle: "Mémoire vidéo", valeur: g.memoireTotaleMo ? `${go(g.memoireUtiliseeMo ?? 0)} / ${go(g.memoireTotaleMo)}` : "—", alerte: Boolean(g.memoireTotaleMo && g.memoireUtiliseeMo && g.memoireUtiliseeMo / g.memoireTotaleMo > 0.9) },
        { libelle: "Puissance", valeur: g.puissanceW !== undefined ? `${Math.round(g.puissanceW)} W / ${g.limiteW !== undefined ? Math.round(g.limiteW) : "?"} W` : "—" },
        { libelle: "Fréquence", valeur: g.frequenceMhz !== undefined ? `${g.frequenceMhz} MHz (max ${g.frequenceMaxMhz ?? "?"})` : "—" },
        { libelle: "Mémoire (fréquence)", valeur: g.frequenceMemoireMhz !== undefined ? `${g.frequenceMemoireMhz} MHz (max ${g.frequenceMemoireMaxMhz ?? "?"})` : "—" },
        { libelle: "Ventilateur", valeur: g.ventilateurPct !== undefined ? `${g.ventilateurPct} %` : "—" },
        { libelle: "Liaison PCIe", valeur: g.pcieLargeur ? `Gen ${g.pcieGen ?? "?"} x${g.pcieLargeur} (max Gen ${g.pcieGenMax ?? "?"} x${g.pcieLargeurMax ?? "?"})` : "—", alerte: Boolean(g.pcieLargeur && g.pcieLargeurMax && g.pcieLargeur < g.pcieLargeurMax) },
      ],
      constats: constats.length ? constats : ["Rien d'anormal."],
    });
  } else {
    reports.push({ id: "carte-graphique", titre: "Carte graphique", etat: "inconnu", mesures: [], constats: ["Carte NVIDIA non détectée (nvidia-smi absent ou pilote non installé)."] });
  }

  // Mémoire
  if (raw.memoire) {
    const m = raw.memoire;
    const used = m.totaleMo - m.libreMo;
    const usedPct = Math.round((used / m.totaleMo) * 100);
    const commitPct = m.engageeMo && m.limiteEngagementMo ? Math.round((m.engageeMo / m.limiteEngagementMo) * 100) : undefined;
    const states: ComponentState[] = ["ok"];
    const constats: string[] = [];
    if (usedPct >= 85) {
      states.push("attention");
      constats.push(`${usedPct} % de la mémoire utilisée : ferme les programmes gourmands (liste ci-dessous) avant de jouer.`);
    }
    if (commitPct !== undefined && commitPct >= 90) {
      states.push("erreur");
      constats.push("Mémoire engagée presque à la limite : un programme peut planter faute de mémoire. Laisse Windows gérer le fichier d'échange et ferme des programmes.");
    }
    if (m.fichierEchangeAuto === false && (m.fichierEchangeMo ?? 0) < 8192) {
      states.push("attention");
      constats.push(`Fichier d'échange réglé à la main (${m.fichierEchangeMo ?? 0} Mo) : avec 16 Go, un fichier trop petit peut faire planter les jeux. Mieux vaut le laisser à Windows.`);
    }
    const slow = m.modules.filter((x) => x.vitesse && x.configuree && x.configuree < x.vitesse - 100);
    if (slow.length) constats.push(`Barrettes à ${slow[0]!.configuree} MHz au lieu de ${slow[0]!.vitesse} MHz : profil XMP/DOCP désactivé dans le BIOS (à activer une fois le PC stable).`);
    if (m.modules.length === 1) constats.push("Une seule barrette : la mémoire fonctionne en simple canal, nettement plus lente (surtout pour la puce graphique intégrée). Deux barrettes identiques sont conseillées.");
    reports.push({
      id: "memoire",
      titre: "Mémoire",
      etat: worst(states),
      mesures: [
        { libelle: "Utilisée", valeur: `${go(used)} / ${go(m.totaleMo)} (${usedPct} %)`, alerte: usedPct >= 85 },
        { libelle: "Engagée", valeur: commitPct !== undefined ? `${go(m.engageeMo!)} / ${go(m.limiteEngagementMo!)} (${commitPct} %)` : "—", alerte: (commitPct ?? 0) >= 90 },
        { libelle: "Fichier d'échange", valeur: `${m.fichierEchangeMo ? go(m.fichierEchangeMo) : "—"}${m.fichierEchangeAuto ? " (géré par Windows)" : m.fichierEchangeAuto === false ? " (réglé à la main)" : ""}` },
        { libelle: "Barrettes", valeur: m.modules.map((x) => `${x.capaciteGo} Go à ${x.configuree ?? "?"} MHz`).join(" + ") || "—" },
      ],
      constats: constats.length ? constats : ["Rien d'anormal."],
    });
  }

  // Disques
  if (raw.disques.length || raw.volumes.length) {
    const states: ComponentState[] = ["ok"];
    const constats: string[] = [];
    for (const d of raw.disques) {
      if (d.sante && !/healthy|sain/i.test(d.sante)) {
        states.push("erreur");
        constats.push(`${d.nom} : Windows le signale « ${d.sante} ». Sauvegarde tes données sans attendre.`);
      }
      if ((d.temperatureC ?? 0) >= 65) {
        states.push("attention");
        constats.push(`${d.nom} à ${d.temperatureC} °C : un SSD NVMe chaud ralentit (un dissipateur aide).`);
      }
      if ((d.usurePct ?? 0) >= 80) {
        states.push("attention");
        constats.push(`${d.nom} usé à ${d.usurePct} % : prévois son remplacement.`);
      }
      if ((d.erreursLecture ?? 0) > 0) {
        states.push("attention");
        constats.push(`${d.nom} : ${d.erreursLecture} erreur(s) de lecture non corrigées.`);
      }
    }
    for (const v of raw.volumes) {
      const pct = v.tailleGo ? Math.round((v.libreGo / v.tailleGo) * 100) : 100;
      if (pct < 10) {
        states.push("attention");
        constats.push(`${v.lettre}: presque plein (${v.libreGo} Go libres).`);
      }
    }
    if (raw.disques.some((d) => /hdd/i.test(d.type)) && raw.disques.some((d) => /ssd/i.test(d.type))) constats.push("Installe les jeux sur le SSD plutôt que sur le disque dur : chargements bien plus rapides.");
    reports.push({
      id: "disques",
      titre: "Disques",
      etat: worst(states),
      mesures: [
        ...raw.disques.map((d) => ({ libelle: d.nom, valeur: `${d.type || "?"}, ${d.tailleGo} Go, ${/healthy/i.test(d.sante) ? "en bonne santé" : d.sante || "?"}${d.temperatureC ? `, ${d.temperatureC} °C` : ""}${d.usurePct !== undefined && d.usurePct !== null ? `, usure ${d.usurePct} %` : ""}`, alerte: !/healthy|sain/i.test(d.sante) })),
        ...raw.volumes.map((v) => ({ libelle: `${v.lettre}:${v.nom ? ` (${v.nom})` : ""}`, valeur: `${v.libreGo} Go libres sur ${v.tailleGo} Go`, alerte: v.tailleGo > 0 && v.libreGo / v.tailleGo < 0.1 })),
      ],
      constats: constats.length ? constats : ["Rien d'anormal."],
    });
  }

  // Réseau
  if (raw.reseau.length) {
    const wifi = raw.reseau.filter((n) => /wi-?fi|wireless|802\.11|native 802/i.test(`${n.type} ${n.description}`));
    const constats = wifi.length && raw.reseau.length === wifi.length ? ["Connexion en Wi-Fi : pour les courses en ligne, un câble Ethernet donne une latence plus stable."] : ["Rien d'anormal."];
    reports.push({ id: "reseau", titre: "Réseau", etat: "ok", mesures: raw.reseau.map((n) => ({ libelle: n.nom, valeur: `${n.description}, ${n.vitesse}` })), constats });
  }

  // Système
  if (raw.systeme) {
    const s = raw.systeme;
    const constats: string[] = [];
    const states: ComponentState[] = ["ok"];
    if ((s.joursAllume ?? 0) >= 7) {
      states.push("attention");
      constats.push(`PC allumé depuis ${Math.floor(s.joursAllume!)} jours sans redémarrage : un redémarrage libère la mémoire et applique les mises à jour en attente.`);
    }
    reports.push({ id: "systeme", titre: "Système", etat: worst(states), mesures: [{ libelle: "Windows", valeur: `${s.windows}${s.build ? ` (build ${s.build})` : ""}` }, { libelle: "Allumé depuis", valeur: s.joursAllume !== undefined ? `${String(s.joursAllume).replace(".", ",")} jour(s)` : "—" }], constats: constats.length ? constats : ["Rien d'anormal."] });
  }

  return reports;
}

/** Programmes qu'on ne propose jamais de fermer (Windows, pilotes, Jarvis lui-même). */
const SYSTEM_PROCESSES = /^(system|idle|registry|smss|csrss|wininit|winlogon|services|lsass|svchost|fontdrvhost|dwm|explorer|memory compression|secure system|audiodg|spoolsv|searchhost|startmenuexperiencehost|shellexperiencehost|sihost|ctfmon|taskhostw|runtimebroker|textinputhost|nvcontainer|nvdisplay\.container|amdrsserv|msmpeng|nissrv|securityhealthservice|jarvis|electron)$/i;

export function canClose(name: string): boolean {
  return !SYSTEM_PROCESSES.test(name.trim());
}

/** Ferme un programme (comme « Fin de tâche ») ; refuse les processus de Windows et Jarvis. */
export async function closeProgram(id: number, name: string): Promise<{ ok: boolean; message: string }> {
  if (!canClose(name)) return { ok: false, message: `${name} fait partie de Windows (ou de Jarvis) : je ne le ferme pas.` };
  const r = await runPowerShell(`$p = Get-Process -Id ${Math.floor(id)} -ErrorAction Stop; if ($p.ProcessName -ne '${name.replace(/'/g, "''")}') { throw 'autre programme' }; $p.CloseMainWindow() | Out-Null; Start-Sleep -Seconds 3; if (-not $p.HasExited) { Stop-Process -Id ${Math.floor(id)} -Force }`, 30_000);
  return r.code === 0 ? { ok: true, message: `${name} fermé.` } : { ok: false, message: `${name} : impossible de le fermer (déjà fermé, ou droits insuffisants).` };
}
