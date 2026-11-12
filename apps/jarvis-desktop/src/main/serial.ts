import { psString } from "./pc.js";

/**
 * Port série par PowerShell (.NET System.IO.Ports, présent dans Windows) :
 * adaptateur OBD ELM327 (Bluetooth « classique » ou USB) et cartes Arduino/ESP32.
 */

export function listPortsScript(): string {
  return "[System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object | ConvertTo-Json -Compress";
}

/**
 * Envoie des commandes ELM327 une à une et renvoie leurs réponses (JSON).
 * Chaque réponse se termine par l'invite « > » de l'adaptateur.
 */
export function elmScript(port: string, commands: string[], baud = 38400, timeoutMs = 6000): string {
  return [
    `$port = New-Object System.IO.Ports.SerialPort ${psString(port)}, ${baud}, 'None', 8, 'One'`,
    "$port.ReadTimeout = 500; $port.WriteTimeout = 1000; $port.NewLine = \"`r\"",
    "$port.Open()",
    "$out = [ordered]@{}",
    "try {",
    `  foreach ($cmd in @(${commands.map(psString).join(", ")})) {`,
    "    $port.DiscardInBuffer()",
    "    $port.Write($cmd + \"`r\")",
    "    $buffer = ''",
    `    $deadline = (Get-Date).AddMilliseconds(${timeoutMs})`,
    "    while ((Get-Date) -lt $deadline -and -not $buffer.Contains('>')) {",
    "      try { $buffer += $port.ReadExisting() } catch {}",
    "      Start-Sleep -Milliseconds 40",
    "    }",
    "    $out[$cmd] = $buffer.Replace('>', '').Trim()",
    "  }",
    "} finally { $port.Close() }",
    "$out | ConvertTo-Json -Compress",
  ].join("\n");
}

/** Cherche l'adaptateur ELM327 : chaque port est essayé à 38400, 9600 puis 115200 bauds. */
export function findElmScript(): string {
  return [
    "$found = $null",
    "foreach ($name in [System.IO.Ports.SerialPort]::GetPortNames()) {",
    "  foreach ($baud in 38400, 9600, 115200) {",
    "    try {",
    "      $p = New-Object System.IO.Ports.SerialPort $name, $baud, 'None', 8, 'One'",
    "      $p.ReadTimeout = 400; $p.Open(); $p.DiscardInBuffer(); $p.Write(\"ATZ`r\"); Start-Sleep -Milliseconds 1200",
    "      $r = $p.ReadExisting(); $p.Close()",
    "      if ($r -match 'ELM') { $found = @{ port = $name; baud = $baud; version = ($r -replace '[>\\r\\n]', ' ').Trim() }; break }",
    "    } catch { try { $p.Close() } catch {} }",
    "  }",
    "  if ($found) { break }",
    "}",
    "if ($found) { $found | ConvertTo-Json -Compress } else { 'null' }",
  ].join("\n");
}

/** Lit ce qu'envoie une carte (moniteur série) pendant quelques secondes. */
export function serialMonitorScript(port: string, baud: number, seconds: number, send?: string): string {
  return [
    `$port = New-Object System.IO.Ports.SerialPort ${psString(port)}, ${baud}, 'None', 8, 'One'`,
    "$port.ReadTimeout = 300; $port.DtrEnable = $true; $port.Open()",
    send ? `$port.WriteLine(${psString(send)})` : "",
    "$text = ''",
    `$deadline = (Get-Date).AddSeconds(${Math.min(120, Math.max(1, seconds))})`,
    "while ((Get-Date) -lt $deadline) { try { $text += $port.ReadExisting() } catch {}; Start-Sleep -Milliseconds 50 }",
    "$port.Close()",
    "$text",
  ]
    .filter(Boolean)
    .join("\n");
}
