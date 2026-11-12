import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Procédures apprises : Alex montre une fois comment faire quelque chose sur
 * le PC (« regarde, je te montre comment exporter le planning »). Jarvis note
 * les clics, les fenêtres, ce qu'Alex dit, et prend des captures ; Claude en
 * tire une procédure écrite que Jarvis peut ensuite refaire seul. Les touches
 * tapées ne sont jamais enregistrées (mots de passe), seulement le fait de taper.
 */

export interface DemoEvent {
  t: number;
  type: "clic" | "clic_droit" | "saisie" | "fenetre" | "parole" | "capture";
  x?: number;
  y?: number;
  fenetre?: string;
  texte?: string;
  fichier?: string;
}

/** Script PowerShell qui surveille souris, fenêtre active et saisie (sans les touches), une ligne JSON par évènement. */
export const WATCH_SCRIPT = String.raw`
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class JW {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@
$lastTitle = ''; $typing = $false; $lastKey = [DateTime]::MinValue; $down = @{1=$false;2=$false}
while ($true) {
  foreach ($b in 1,2) {
    $pressed = ([JW]::GetAsyncKeyState($b) -band 0x8000) -ne 0
    if ($pressed -and -not $down[$b]) {
      $p = New-Object JW+POINT; [void][JW]::GetCursorPos([ref]$p)
      $type = if ($b -eq 1) { 'clic' } else { 'clic_droit' }
      [Console]::Out.WriteLine((@{ type = $type; x = $p.X; y = $p.Y } | ConvertTo-Json -Compress)); [Console]::Out.Flush()
    }
    $down[$b] = $pressed
  }
  $anyKey = $false
  foreach ($k in 8,9,13,32 + (48..90) + (96..111) + (186..222)) { if (([JW]::GetAsyncKeyState($k) -band 0x8000) -ne 0) { $anyKey = $true; break } }
  if ($anyKey) { $lastKey = [DateTime]::Now; if (-not $typing) { $typing = $true; [Console]::Out.WriteLine('{"type":"saisie"}'); [Console]::Out.Flush() } }
  elseif ($typing -and ([DateTime]::Now - $lastKey).TotalMilliseconds -gt 1500) { $typing = $false }
  $sb = New-Object System.Text.StringBuilder 512; [void][JW]::GetWindowText([JW]::GetForegroundWindow(), $sb, 512)
  $title = $sb.ToString()
  if ($title -ne $lastTitle) { $lastTitle = $title; [Console]::Out.WriteLine((@{ type = 'fenetre'; fenetre = $title } | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
  Start-Sleep -Milliseconds 30
}
`;

function slug(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "procedure";
}

/** Fusionne les évènements en étapes lisibles (clics groupés, saisie, changements de fenêtre). */
export function summarizeDemo(events: DemoEvent[], startedAt: number): string[] {
  const lines: string[] = [];
  let lastWindow = "";
  for (const e of events) {
    const at = `${Math.round((e.t - startedAt) / 1000)} s`;
    if (e.type === "fenetre") {
      if (e.fenetre && e.fenetre !== lastWindow) lines.push(`[${at}] Fenêtre active : « ${e.fenetre} »`);
      lastWindow = e.fenetre ?? lastWindow;
    } else if (e.type === "clic" || e.type === "clic_droit") lines.push(`[${at}] ${e.type === "clic" ? "Clic" : "Clic droit"} en (${e.x}, ${e.y}) dans « ${lastWindow} »`);
    else if (e.type === "saisie") lines.push(`[${at}] Alex tape au clavier dans « ${lastWindow} » (touches non enregistrées)`);
    else if (e.type === "parole") lines.push(`[${at}] Alex dit : « ${e.texte} »`);
    else if (e.type === "capture") lines.push(`[${at}] Capture d'écran : ${e.fichier}`);
  }
  return lines;
}

export class Procedures {
  readonly dir: string;
  private recording: { nom: string; dossier: string; startedAt: number; events: DemoEvent[]; watcher?: ChildProcess; timer?: NodeJS.Timeout; captures: number } | undefined;

  constructor(
    workspace: string,
    private readonly capture: () => Promise<Buffer | undefined>,
  ) {
    this.dir = path.join(workspace, "procedures");
    mkdirSync(this.dir, { recursive: true });
  }

  get isRecording(): boolean {
    return this.recording !== undefined;
  }

  get currentName(): string | undefined {
    return this.recording?.nom;
  }

  list(): Array<{ nom: string; dossier: string; description: string }> {
    return readdirSync(this.dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(path.join(this.dir, d.name, "PROCEDURE.md")))
      .map((d) => {
        const text = readFileSync(path.join(this.dir, d.name, "PROCEDURE.md"), "utf8");
        return { nom: text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? d.name, dossier: path.join(this.dir, d.name), description: text.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim().slice(0, 200) ?? "" };
      });
  }

  read(name: string): string | undefined {
    const direct = path.join(this.dir, slug(name), "PROCEDURE.md");
    if (existsSync(direct)) return readFileSync(direct, "utf8");
    const found = this.list().find((p) => p.nom.toLowerCase().includes(name.toLowerCase()) || path.basename(p.dossier).includes(slug(name)));
    return found ? readFileSync(path.join(found.dossier, "PROCEDURE.md"), "utf8") : undefined;
  }

  write(name: string, markdown: string): string {
    const dossier = path.join(this.dir, slug(name));
    mkdirSync(dossier, { recursive: true });
    const file = path.join(dossier, "PROCEDURE.md");
    writeFileSync(file, markdown.startsWith("#") ? markdown : `# ${name}\n\n${markdown}`);
    return file;
  }

  start(name: string): string {
    if (this.recording) this.stop();
    const dossier = path.join(this.dir, slug(name));
    mkdirSync(path.join(dossier, "captures"), { recursive: true });
    const rec: NonNullable<Procedures["recording"]> = { nom: name, dossier, startedAt: Date.now(), events: [], captures: 0 };
    this.recording = rec;
    if (process.platform === "win32") {
      const watcher = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", WATCH_SCRIPT], { windowsHide: true });
      rec.watcher = watcher;
      let buffer = "";
      watcher.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          try {
            const e = JSON.parse(line) as Omit<DemoEvent, "t">;
            rec.events.push({ ...e, t: Date.now() });
            if (e.type === "clic" || e.type === "clic_droit") setTimeout(() => void this.snap(), 350);
          } catch {
            // ligne incomplète
          }
        }
      });
    }
    // Une capture toutes les 4 secondes au plus, même sans clic.
    rec.timer = setInterval(() => void this.snap(), 4000);
    void this.snap();
    return dossier;
  }

  /** Ce qu'Alex dit pendant la démonstration. */
  narrate(text: string): void {
    this.recording?.events.push({ t: Date.now(), type: "parole", texte: text });
  }

  private lastSnap = 0;

  private async snap(): Promise<void> {
    const rec = this.recording;
    if (!rec || rec.captures >= 40 || Date.now() - this.lastSnap < 900) return;
    this.lastSnap = Date.now();
    const image = await this.capture().catch(() => undefined);
    if (!image || this.recording !== rec) return;
    rec.captures += 1;
    const file = path.join(rec.dossier, "captures", `${String(rec.captures).padStart(2, "0")}.jpg`);
    writeFileSync(file, image);
    rec.events.push({ t: Date.now(), type: "capture", fichier: file });
  }

  /** Arrête l'enregistrement et renvoie le résumé à transformer en procédure. */
  stop(): { nom: string; dossier: string; etapes: string[]; captures: string[] } | undefined {
    const rec = this.recording;
    if (!rec) return undefined;
    this.recording = undefined;
    rec.watcher?.kill();
    if (rec.timer) clearInterval(rec.timer);
    const etapes = summarizeDemo(rec.events, rec.startedAt);
    writeFileSync(path.join(rec.dossier, "enregistrement.txt"), etapes.join("\n"));
    const captures = rec.events.filter((e) => e.type === "capture" && e.fichier).map((e) => e.fichier!);
    return { nom: rec.nom, dossier: rec.dossier, etapes, captures };
  }
}

/** Consigne pour transformer un enregistrement en procédure réutilisable. */
export function procedurePrompt(rec: { nom: string; dossier: string; etapes: string[]; captures: string[] }): string {
  const chosen = rec.captures.length <= 16 ? rec.captures : rec.captures.filter((_, i) => i % Math.ceil(rec.captures.length / 16) === 0);
  return `Alex vient de te montrer comment faire : « ${rec.nom} ». Voici ce que j'ai enregistré (clics en pixels réels de l'écran, fenêtres, paroles d'Alex) :

${rec.etapes.join("\n")}

Regarde les captures avec l'outil Read : ${chosen.join(" ; ")}

Écris la procédure dans ${path.join(rec.dossier, "PROCEDURE.md")}, en Markdown :
- « # ${rec.nom} », puis une phrase qui dit ce que fait la procédure et quand l'utiliser ;
- « ## Avant de commencer » : programmes, fichiers, comptes nécessaires ;
- « ## Étapes » numérotées et précises : quelle fenêtre, quel bouton (son libellé et où il est), quel menu. Préfère les raccourcis clavier, les commandes PowerShell ou les adresses directes aux positions de souris, qui changent ; donne la position seulement en dernier recours ;
- « ## Paramètres » : ce qui change d'une fois à l'autre (date, fichier, destinataire…) ;
- « ## Vérification » : comment savoir que c'est réussi ;
- « ## Pièges » : ce qui peut mal tourner.
Puis dis à Alex en une phrase que tu sais maintenant le faire, et ce que tu lui demanderas la prochaine fois (les paramètres).`;
}
