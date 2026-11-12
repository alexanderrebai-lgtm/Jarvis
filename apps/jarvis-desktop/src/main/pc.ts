import { spawn } from "node:child_process";

/**
 * Contrôle de Windows sans module natif à compiler : tout passe par PowerShell
 * (et quelques fonctions de user32.dll pour la souris et le clavier).
 */

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const MAX_OUTPUT = 20_000;

function clip(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n[… sortie tronquée]` : text;
}

export function runPowerShell(script: string, timeoutMs = 120_000, cwd?: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    // Le script passe en base64 (UTF-16LE) : aucun souci de guillemets ni d'accents.
    const encoded = Buffer.from(`$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ${script}`, "utf16le").toString("base64");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      windowsHide: true,
      ...(cwd ? { cwd } : {}),
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout: "", stderr: error.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: clip(stdout.trim()), stderr: clip(stderr.trim()), timedOut });
    });
  });
}

/** Échappe une chaîne pour PowerShell entre apostrophes. */
export function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const USER32 = `Add-Type -Name U -Namespace J -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int data, IntPtr extra);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
'@
[void][J.U]::SetProcessDPIAware()`;

export type MouseAction = "deplacer" | "clic" | "double_clic" | "clic_droit" | "molette_haut" | "molette_bas" | "glisser";

/** Script de souris (coordonnées physiques de l'écran). */
export function mouseScript(action: MouseAction, x: number, y: number, toX?: number, toY?: number): string {
  const px = Math.round(x);
  const py = Math.round(y);
  const lines = [USER32, `[void][J.U]::SetCursorPos(${px}, ${py}); Start-Sleep -Milliseconds 60`];
  const click = (down: number, up: number) => `[J.U]::mouse_event(${down},0,0,0,[IntPtr]::Zero); [J.U]::mouse_event(${up},0,0,0,[IntPtr]::Zero)`;
  switch (action) {
    case "deplacer":
      break;
    case "clic":
      lines.push(click(0x02, 0x04));
      break;
    case "double_clic":
      lines.push(click(0x02, 0x04), "Start-Sleep -Milliseconds 80", click(0x02, 0x04));
      break;
    case "clic_droit":
      lines.push(click(0x08, 0x10));
      break;
    case "molette_haut":
      lines.push("[J.U]::mouse_event(0x0800,0,0,360,[IntPtr]::Zero)");
      break;
    case "molette_bas":
      lines.push("[J.U]::mouse_event(0x0800,0,0,-360,[IntPtr]::Zero)");
      break;
    case "glisser":
      lines.push(
        "[J.U]::mouse_event(0x02,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 100",
        `[void][J.U]::SetCursorPos(${Math.round(toX ?? x)}, ${Math.round(toY ?? y)}); Start-Sleep -Milliseconds 100`,
        "[J.U]::mouse_event(0x04,0,0,0,[IntPtr]::Zero)",
      );
      break;
  }
  return lines.join("\n");
}

/** Touches virtuelles Windows pour les raccourcis (« ctrl+shift+esc », « win+d », « volume_haut »…). */
const KEYS: Record<string, number> = {
  ctrl: 0x11, control: 0x11, shift: 0x10, maj: 0x10, alt: 0x12, win: 0x5b, windows: 0x5b,
  enter: 0x0d, entree: 0x0d, tab: 0x09, esc: 0x1b, echap: 0x1b, escape: 0x1b, space: 0x20, espace: 0x20,
  backspace: 0x08, retour: 0x08, delete: 0x2e, suppr: 0x2e, home: 0x24, end: 0x23, fin: 0x23,
  pageup: 0x21, pagedown: 0x22, up: 0x26, haut: 0x26, down: 0x28, bas: 0x28, left: 0x25, gauche: 0x25, right: 0x27, droite: 0x27,
  printscreen: 0x2c, volume_haut: 0xaf, volume_bas: 0xae, muet: 0xad, lecture: 0xb3, piste_suivante: 0xb0, piste_precedente: 0xb1,
};

export function keyCode(name: string): number {
  const key = name.trim().toLowerCase();
  if (KEYS[key] !== undefined) return KEYS[key]!;
  if (/^f([1-9]|1[0-2])$/.test(key)) return 0x6f + Number(key.slice(1));
  if (/^[a-z0-9]$/.test(key)) return key.toUpperCase().charCodeAt(0);
  throw new Error(`Touche inconnue : ${name}`);
}

/** Raccourci clavier : touches enfoncées dans l'ordre, relâchées à l'envers. */
export function hotkeyScript(combo: string): string {
  const codes = combo.split("+").map(keyCode);
  const down = codes.map((c) => `[J.U]::keybd_event(${c},0,0,[IntPtr]::Zero)`);
  const up = [...codes].reverse().map((c) => `[J.U]::keybd_event(${c},0,2,[IntPtr]::Zero)`);
  return [USER32, ...down, "Start-Sleep -Milliseconds 50", ...up].join("\n");
}

/** Frappe de texte par le presse-papiers (fiable avec les accents), puis restauration de celui-ci. */
export function typeScript(text: string): string {
  return [
    USER32,
    "Add-Type -AssemblyName System.Windows.Forms",
    "$old = Get-Clipboard -Raw -ErrorAction SilentlyContinue",
    `Set-Clipboard -Value ${psString(text)}`,
    "Start-Sleep -Milliseconds 80",
    "[J.U]::keybd_event(0x11,0,0,[IntPtr]::Zero); [J.U]::keybd_event(0x56,0,0,[IntPtr]::Zero); [J.U]::keybd_event(0x56,0,2,[IntPtr]::Zero); [J.U]::keybd_event(0x11,0,2,[IntPtr]::Zero)",
    "Start-Sleep -Milliseconds 150",
    "if ($null -ne $old) { Set-Clipboard -Value $old }",
  ].join("\n");
}

export const LIST_WINDOWS_SCRIPT = `Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress`;

export function focusWindowScript(match: string): string {
  return [
    USER32,
    `$p = Get-Process | Where-Object { $_.MainWindowTitle -like ${psString(`*${match}*`)} -or $_.ProcessName -like ${psString(`*${match}*`)} } | Where-Object { $_.MainWindowTitle } | Select-Object -First 1`,
    "if (-not $p) { Write-Output 'introuvable'; exit 1 }",
    "[void][J.U]::ShowWindow($p.MainWindowHandle, 9); [void][J.U]::SetForegroundWindow($p.MainWindowHandle)",
    "Write-Output $p.MainWindowTitle",
  ].join("\n");
}

/** Ouvre une application, un fichier, un dossier ou une adresse web. */
export function openScript(target: string, args?: string): string {
  return `Start-Process -FilePath ${psString(target)}${args ? ` -ArgumentList ${psString(args)}` : ""}`;
}
