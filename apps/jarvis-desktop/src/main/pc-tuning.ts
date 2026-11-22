import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runPowerShell } from "./pc.js";

/**
 * Optimisations du PC : un catalogue de réglages Windows reconnus et sans
 * danger. Chaque changement se fait sur demande d'Alex, est noté, et peut être
 * annulé (Jarvis garde l'ancienne valeur). Ceux qui touchent au système
 * passent par l'autorisation administrateur de Windows.
 */

export type TweakCategory = "Jeu" | "Stabilité" | "Windows" | "Entretien";

interface RegValue {
  hive: "HKCU" | "HKLM";
  path: string;
  name: string;
  value: number;
}

interface BaseTweak {
  id: string;
  titre: string;
  description: string;
  categorie: TweakCategory;
  /** Redémarrage du PC nécessaire pour que le changement prenne effet. */
  redemarrage?: boolean;
}

/** Réglage du registre (valeur DWORD) : réversible exactement. */
export interface RegistryTweak extends BaseTweak {
  kind: "registre";
  valeurs: RegValue[];
}

/** Action ponctuelle (nettoyage, TRIM, point de restauration) : rien à annuler. */
export interface OneShotTweak extends BaseTweak {
  kind: "ponctuel";
  admin: boolean;
  script: string;
  resultat: (stdout: string) => string;
}

export type Tweak = RegistryTweak | OneShotTweak;

export const TWEAKS: Tweak[] = [
  {
    id: "mode-jeu-windows",
    kind: "registre",
    titre: "Mode jeu de Windows",
    description: "Donne la priorité au jeu et bloque les installations de mises à jour pendant les parties.",
    categorie: "Jeu",
    valeurs: [{ hive: "HKCU", path: "Software\\Microsoft\\GameBar", name: "AutoGameModeEnabled", value: 1 }],
  },
  {
    id: "capture-arriere-plan",
    kind: "registre",
    titre: "Couper l'enregistrement en arrière-plan de la Xbox Game Bar",
    description: "Windows peut enregistrer les dernières minutes de jeu en permanence : ça coûte des images par seconde et de la mémoire vidéo. Les captures manuelles restent possibles.",
    categorie: "Jeu",
    valeurs: [
      { hive: "HKCU", path: "System\\GameConfigStore", name: "GameDVR_Enabled", value: 0 },
      { hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR", name: "AppCaptureEnabled", value: 0 },
    ],
  },
  {
    id: "planification-gpu",
    kind: "registre",
    titre: "Planification GPU accélérée par le matériel",
    description: "La carte graphique gère elle-même sa file de travail : un peu moins de latence, et nécessaire à la génération d'images DLSS 3.",
    categorie: "Jeu",
    redemarrage: true,
    valeurs: [{ hive: "HKLM", path: "SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers", name: "HwSchMode", value: 2 }],
  },
  {
    id: "demarrage-rapide",
    kind: "registre",
    titre: "Désactiver le démarrage rapide de Windows",
    description: "Le démarrage rapide garde une partie de Windows et des pilotes en veille entre deux allumages : le couper donne un vrai redémarrage à chaque fois, ce qui règle souvent des pilotes instables. Le démarrage prend quelques secondes de plus.",
    categorie: "Stabilité",
    valeurs: [{ hive: "HKLM", path: "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power", name: "HiberbootEnabled", value: 0 }],
  },
  {
    id: "transparence",
    kind: "registre",
    titre: "Couper les effets de transparence",
    description: "Menus et barre des tâches opaques : un peu moins de travail pour la carte graphique, sans autre changement visible.",
    categorie: "Windows",
    valeurs: [{ hive: "HKCU", path: "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", name: "EnableTransparency", value: 0 }],
  },
  {
    id: "point-restauration",
    kind: "ponctuel",
    titre: "Créer un point de restauration",
    description: "Une photo de Windows et du registre : si un réglage pose problème, on revient en arrière depuis « Restauration du système ». Conseillé avant les réglages qui demandent l'autorisation administrateur.",
    categorie: "Entretien",
    admin: true,
    script: `Enable-ComputerRestore -Drive "$env:SystemDrive\\" -ErrorAction SilentlyContinue; Checkpoint-Computer -Description 'Jarvis - avant optimisation' -RestorePointType MODIFY_SETTINGS -ErrorAction Stop`,
    resultat: () => "Point de restauration créé (Windows n'en crée qu'un par jour au plus).",
  },
  {
    id: "trim",
    kind: "ponctuel",
    titre: "Optimiser les SSD (TRIM)",
    description: "Signale aux SSD les blocs libérés : ils gardent leurs performances d'écriture. Windows le fait chaque semaine ; utile si la tâche est désactivée.",
    categorie: "Entretien",
    admin: true,
    script: `Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' } | ForEach-Object { Optimize-Volume -DriveLetter $_.DriveLetter -ReTrim -ErrorAction SilentlyContinue }`,
    resultat: () => "TRIM lancé sur les disques (sans effet sur les disques durs classiques).",
  },
  {
    id: "nettoyage-windows",
    kind: "ponctuel",
    titre: "Nettoyage de disque de Windows",
    description: "Ouvre l'outil de Windows pour les fichiers de mise à jour, miniatures et journaux devenus inutiles (tu choisis ce qui part).",
    categorie: "Entretien",
    admin: false,
    script: `Start-Process cleanmgr.exe -ArgumentList '/d', ($env:SystemDrive.TrimEnd(':'))`,
    resultat: () => "Nettoyage de disque ouvert : coche ce que tu veux supprimer, puis « Nettoyer les fichiers système » pour aller plus loin.",
  },
];

const BALANCED = "381b4222-f694-41f0-9685-ff5bb260df2e";

// ---------- Lecture de l'état ----------

const psPath = (v: RegValue) => `'${v.hive}:\\${v.path.replace(/'/g, "''")}'`;

/** Script qui lit toutes les valeurs du catalogue, les programmes au démarrage et le fichier d'échange. */
export function stateScript(): string {
  const reads = TWEAKS.flatMap((t) => (t.kind === "registre" ? t.valeurs : [])).map((v) => `$r[${JSON.stringify(`${v.hive}\\${v.path}\\${v.name}`)}] = (Get-ItemProperty -Path ${psPath(v)} -Name '${v.name}' -ErrorAction SilentlyContinue).'${v.name}'`);
  return `
$ErrorActionPreference = 'SilentlyContinue'
$r = @{}
${reads.join("\n")}
$startup = @()
foreach ($hive in 'HKCU','HKLM') {
  $run = Get-ItemProperty "$($hive):\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
  $approved = Get-ItemProperty "$($hive):\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run"
  if ($run) {
    foreach ($p in $run.PSObject.Properties) {
      if ($p.Name -like 'PS*') { continue }
      $flag = $approved.($p.Name)
      $startup += [pscustomobject]@{ nom = $p.Name; commande = [string]$p.Value; ruche = $hive; actif = -not ($flag -and $flag[0] -eq 3) }
    }
  }
}
$cs = Get-CimInstance Win32_ComputerSystem
$plan = (powercfg /getactivescheme) -join ' '
[pscustomobject]@{ registre = $r; demarrage = $startup; fichierEchangeAuto = $cs.AutomaticManagedPagefile; plan = $plan } | ConvertTo-Json -Depth 4 -Compress
`;
}

export interface StartupEntry {
  nom: string;
  commande: string;
  ruche: "HKCU" | "HKLM";
  actif: boolean;
}

export interface TuningState {
  reglages: Array<{ id: string; titre: string; description: string; categorie: TweakCategory; actif: boolean | null; admin: boolean; redemarrage: boolean; ponctuel: boolean; annulable: boolean }>;
  demarrage: StartupEntry[];
  fichierEchangeAuto: boolean | null;
}

export function parseState(json: string, applied: Record<string, unknown>): TuningState {
  const d = JSON.parse(json) as { registre?: Record<string, unknown>; demarrage?: StartupEntry | StartupEntry[]; fichierEchangeAuto?: boolean | null };
  const reg = d.registre ?? {};
  return {
    reglages: TWEAKS.map((t) => {
      const admin = t.kind === "registre" ? t.valeurs.some((v) => v.hive === "HKLM") : t.admin;
      const actif = t.kind === "registre" ? t.valeurs.every((v) => Number(reg[`${v.hive}\\${v.path}\\${v.name}`]) === v.value) : null;
      return { id: t.id, titre: t.titre, description: t.description, categorie: t.categorie, actif, admin, redemarrage: Boolean(t.redemarrage), ponctuel: t.kind === "ponctuel", annulable: t.kind === "registre" && t.id in applied };
    }),
    demarrage: d.demarrage === undefined || d.demarrage === null ? [] : Array.isArray(d.demarrage) ? d.demarrage : [d.demarrage],
    fichierEchangeAuto: d.fichierEchangeAuto ?? null,
  };
}

// ---------- Changements ----------

/** Script élevé : Windows affiche sa demande d'autorisation ; le code de sortie dit si ça a marché. */
export function elevated(script: string): string {
  const encoded = Buffer.from(`$ErrorActionPreference='Stop'; ${script}`, "utf16le").toString("base64");
  return `$p = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-EncodedCommand','${encoded}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
}

function setScript(v: RegValue, value: number | null): string {
  const p = psPath(v);
  if (value === null) return `Remove-ItemProperty -Path ${p} -Name '${v.name}' -ErrorAction SilentlyContinue`;
  return `if (-not (Test-Path ${p})) { New-Item -Path ${p} -Force | Out-Null }; Set-ItemProperty -Path ${p} -Name '${v.name}' -Value ${value} -Type DWord -Force`;
}

/** Valeurs d'avant les changements de Jarvis, pour les annuler. */
export class TuningStore {
  private readonly file: string;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, "optimisations.json");
  }

  read(): Record<string, { avant: Record<string, number | null>; date: string }> {
    if (!existsSync(this.file)) return {};
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as Record<string, { avant: Record<string, number | null>; date: string }>;
    } catch {
      return {};
    }
  }

  write(data: ReturnType<TuningStore["read"]>): void {
    writeFileSync(this.file, JSON.stringify(data, null, 1));
  }
}

export type Runner = (script: string, timeoutMs?: number) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export class PcTuning {
  readonly store: TuningStore;

  constructor(dataDir: string, private readonly run: Runner = runPowerShell) {
    this.store = new TuningStore(dataDir);
  }

  async state(): Promise<TuningState> {
    const r = await this.run(stateScript(), 60_000);
    const json = r.stdout.slice(r.stdout.indexOf("{"));
    return parseState(json || "{}", this.store.read());
  }

  /** Applique (ou annule) un réglage du catalogue. Renvoie un message pour Alex. */
  async apply(id: string, undo = false): Promise<{ ok: boolean; message: string }> {
    const tweak = TWEAKS.find((t) => t.id === id);
    if (!tweak) return { ok: false, message: `Réglage inconnu : ${id}.` };

    if (tweak.kind === "ponctuel") {
      if (undo) return { ok: false, message: "Cette action ne s'annule pas (elle ne change aucun réglage)." };
      const r = await this.run(tweak.admin ? elevated(tweak.script) : tweak.script, 900_000);
      return r.code === 0 ? { ok: true, message: tweak.resultat(r.stdout) } : { ok: false, message: `${tweak.titre} : ${tweak.admin ? "autorisation refusée ou échec" : "échec"}${r.stderr ? ` (${r.stderr.slice(0, 200)})` : ""}.` };
    }

    const saved = this.store.read();
    const key = (v: RegValue) => `${v.hive}\\${v.path}\\${v.name}`;
    let script: string;
    if (undo) {
      const before = saved[id]?.avant;
      if (!before) return { ok: false, message: "Rien à annuler : ce réglage n'a pas été changé par Jarvis." };
      script = tweak.valeurs.map((v) => setScript(v, before[key(v)] ?? null)).join("; ");
    } else {
      // Valeurs actuelles gardées pour pouvoir revenir en arrière.
      const read = await this.run(`$ErrorActionPreference='SilentlyContinue'; @{ ${tweak.valeurs.map((v) => `${JSON.stringify(key(v))} = (Get-ItemProperty -Path ${psPath(v)} -Name '${v.name}').'${v.name}'`).join("; ")} } | ConvertTo-Json -Compress`, 30_000);
      let before: Record<string, number | null> = {};
      try {
        const parsed = JSON.parse(read.stdout.slice(read.stdout.indexOf("{")) || "{}") as Record<string, unknown>;
        before = Object.fromEntries(tweak.valeurs.map((v) => [key(v), parsed[key(v)] === null || parsed[key(v)] === undefined ? null : Number(parsed[key(v)])]));
      } catch {
        before = Object.fromEntries(tweak.valeurs.map((v) => [key(v), null]));
      }
      if (!saved[id]) saved[id] = { avant: before, date: new Date().toISOString() };
      script = tweak.valeurs.map((v) => setScript(v, v.value)).join("; ");
    }
    const admin = tweak.valeurs.some((v) => v.hive === "HKLM");
    const r = await this.run(admin ? elevated(script) : script, 120_000);
    if (r.code !== 0) return { ok: false, message: `${tweak.titre} : ${admin ? "autorisation refusée ou échec" : "échec"}.` };
    if (undo) delete saved[id];
    this.store.write(saved);
    const reboot = tweak.redemarrage ? " Redémarre le PC pour que ce soit pris en compte." : "";
    return { ok: true, message: undo ? `${tweak.titre} : remis comme avant.${reboot}` : `${tweak.titre} : fait.${reboot} (annulable depuis la page Santé du PC)` };
  }

  /** Active ou désactive un programme au démarrage (comme le Gestionnaire des tâches : rien n'est supprimé). */
  async setStartup(entry: { nom: string; ruche: "HKCU" | "HKLM" }, enable: boolean): Promise<{ ok: boolean; message: string }> {
    const key = `'${entry.ruche}:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'`;
    const bytes = enable ? "2,0,0,0,0,0,0,0,0,0,0,0" : "3,0,0,0,0,0,0,0,0,0,0,0";
    const name = entry.nom.replace(/'/g, "''");
    const script = `if (-not (Test-Path ${key})) { New-Item -Path ${key} -Force | Out-Null }; Set-ItemProperty -Path ${key} -Name '${name}' -Value ([byte[]](${bytes})) -Type Binary -Force`;
    const r = await this.run(entry.ruche === "HKLM" ? elevated(script) : script, 60_000);
    return r.code === 0 ? { ok: true, message: `${entry.nom} ${enable ? "se lancera" : "ne se lancera plus"} au démarrage de Windows.` } : { ok: false, message: `${entry.nom} : ${entry.ruche === "HKLM" ? "autorisation refusée ou échec" : "échec"}.` };
  }

  /** Remet le fichier d'échange en gestion automatique par Windows (taille adaptée à la mémoire). */
  async automaticPagefile(): Promise<{ ok: boolean; message: string }> {
    const r = await this.run(elevated(`$cs = Get-CimInstance Win32_ComputerSystem; Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $true }`), 120_000);
    return r.code === 0 ? { ok: true, message: "Fichier d'échange géré par Windows. Redémarre le PC pour que ce soit pris en compte." } : { ok: false, message: "Autorisation refusée ou échec." };
  }

  /** Plan d'alimentation « Utilisation normale » (pour annuler « Performances élevées »). */
  async balancedPlan(): Promise<{ ok: boolean; message: string }> {
    const r = await this.run(`powercfg /setactive ${BALANCED}`);
    return r.code === 0 ? { ok: true, message: "Plan « Utilisation normale » rétabli." } : { ok: false, message: "Impossible de changer de plan." };
  }
}
