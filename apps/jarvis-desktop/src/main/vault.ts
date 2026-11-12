import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Coffre-fort : les mots de passe et jetons sont chiffrés par Windows (DPAPI,
 * via safeStorage d'Electron), liés à ta session Windows. Au démarrage, ceux
 * que tu as tapés dans jarvis.env y sont déplacés et remplacés par « @coffre ».
 */

export interface Cipher {
  available: () => boolean;
  encrypt: (text: string) => Buffer;
  decrypt: (data: Buffer) => string;
}

export const SECRET_KEYS = [
  "ANTHROPIC_API_KEY",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "TAPO_PASSWORD",
  "TAPO_CAMERA_MOT_DE_PASSE",
  "HOME_ASSISTANT_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "WEBHOOK_SECRET",
  "OPENALEX_CLE",
  "SEMANTIC_SCHOLAR_CLE",
  "NCBI_CLE",
];

export const VAULT_MARKER = "@coffre";

export class Vault {
  private readonly file: string;
  private cache: Record<string, string> | undefined;
  private unreadable = false;

  constructor(dir: string, private readonly cipher: Cipher) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "coffre.bin");
  }

  get available(): boolean {
    return this.cipher.available();
  }

  private read(): Record<string, string> {
    if (this.cache) return this.cache;
    if (!existsSync(this.file) || !this.available) return (this.cache = {});
    try {
      this.cache = JSON.parse(this.cipher.decrypt(readFileSync(this.file))) as Record<string, string>;
    } catch {
      // Coffre illisible (autre session Windows, ancien format, fichier abîmé) : on repart à vide sans l'écraser.
      this.unreadable = true;
      return {};
    }
    return this.cache;
  }

  private write(values: Record<string, string>): void {
    if (!this.available) throw new Error("Le chiffrement de Windows n'est pas disponible.");
    // Un coffre illisible n'est jamais écrasé : il est mis de côté.
    if (this.unreadable && existsSync(this.file)) renameSync(this.file, `${this.file}.${Date.now()}.illisible`);
    this.unreadable = false;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, this.cipher.encrypt(JSON.stringify(values)));
    renameSync(tmp, this.file);
    this.cache = values;
  }

  get(key: string): string | undefined {
    return this.read()[key];
  }

  set(key: string, value: string | undefined): void {
    const next = { ...this.read() };
    if (value === undefined || value === "") delete next[key];
    else next[key] = value;
    this.write(next);
  }

  getJson<T>(key: string): T | undefined {
    const raw = this.get(key);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  setJson(key: string, value: unknown): void {
    this.set(key, value === undefined ? undefined : JSON.stringify(value));
  }

  keys(): string[] {
    return Object.keys(this.read());
  }

  /** Oublie ce qui est en mémoire (après une conversion du fichier). */
  reset(): void {
    this.cache = undefined;
    this.unreadable = false;
  }
}

/**
 * Déplace les secrets de jarvis.env dans le coffre, puis remplit process.env
 * depuis le coffre. Renvoie les clés déplacées.
 */
export function migrateEnvSecrets(envFile: string, vault: Vault, env: NodeJS.ProcessEnv = process.env, keys = SECRET_KEYS): string[] {
  if (!vault.available || !existsSync(envFile)) return [];
  const lines = readFileSync(envFile, "utf8").split(/\r?\n/);
  const moved: string[] = [];
  const next = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m || !keys.includes(m[1]!)) return line;
    const value = m[2]!.trim().replace(/^["']|["']$/g, "");
    if (!value || value === VAULT_MARKER) return line;
    vault.set(m[1]!, value);
    moved.push(m[1]!);
    return `${m[1]}=${VAULT_MARKER}`;
  });
  if (moved.length) writeFileSync(envFile, next.join("\n"));
  for (const key of keys) {
    const current = env[key]?.trim();
    if (!current || current === VAULT_MARKER || moved.includes(key)) {
      const secret = vault.get(key);
      if (secret) env[key] = secret;
      else if (current === VAULT_MARKER) delete env[key];
    }
  }
  return moved;
}

/** En-tête des coffres chiffrés directement par Windows (DPAPI). */
export const DPAPI_HEADER = "DPAPI1:";

/**
 * Chiffrement Windows (DPAPI, lié à ta session) par PowerShell. Contrairement à
 * safeStorage d'Electron, il est disponible dès le lancement, avant que la
 * fenêtre de Jarvis soit prête : les mots de passe sont lus à temps.
 * Les données passent par l'entrée standard, jamais sur la ligne de commande.
 */
export function dpapiCipher(run: (script: string, input: string) => string = runPowerShellSync): Cipher {
  const script = (method: "Protect" | "Unprotect") =>
    `Add-Type -AssemblyName System.Security; $d = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${method}($d, $null, 'CurrentUser'))`;
  return {
    available: () => process.platform === "win32",
    encrypt: (text) => Buffer.from(`${DPAPI_HEADER}${run(script("Protect"), Buffer.from(text, "utf8").toString("base64")).trim()}`),
    decrypt: (data) => {
      const raw = data.toString("utf8");
      if (!raw.startsWith(DPAPI_HEADER)) throw new Error("ancien format du coffre");
      return Buffer.from(run(script("Unprotect"), raw.slice(DPAPI_HEADER.length)).trim(), "base64").toString("utf8");
    },
  };
}

function runPowerShellSync(script: string, input: string): string {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { input, encoding: "utf8", windowsHide: true, timeout: 20_000 });
}

/** Le coffre a-t-il été écrit dans l'ancien format (safeStorage) ? */
export function isLegacyVault(dir: string): boolean {
  const file = path.join(dir, "coffre.bin");
  return existsSync(file) && !readFileSync(file).subarray(0, DPAPI_HEADER.length).equals(Buffer.from(DPAPI_HEADER));
}

/** Convertit un ancien coffre (safeStorage) vers le nouveau format. Renvoie le nombre de secrets repris. */
export function migrateLegacyVault(dir: string, legacyDecrypt: (data: Buffer) => string, target: Vault): number {
  const file = path.join(dir, "coffre.bin");
  const values = JSON.parse(legacyDecrypt(readFileSync(file))) as Record<string, string>;
  renameSync(file, `${file}.ancien`);
  target.reset();
  for (const [key, value] of Object.entries(values)) target.set(key, value);
  return Object.keys(values).length;
}
