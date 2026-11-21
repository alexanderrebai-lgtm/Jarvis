import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Sauvegarde portable des mots de passe : le coffre-fort de Jarvis est chiffré
 * par ta session Windows, donc illisible après une réinstallation. Cette copie
 * est chiffrée avec TON mot de passe de sauvegarde (AES-256-GCM, clé dérivée
 * par scrypt) : elle se restaure sur n'importe quel PC.
 */

export interface SecretBundle {
  version: 1;
  date: string;
  /** Contenu du coffre-fort (mots de passe, jetons). */
  coffre: Record<string, string>;
  /** Réglages non secrets (jarvis.env). */
  reglages: string;
}

const MAGIC = "JARVIS-COFFRE-1";
const N = 2 ** 15;

function key(password: string, salt: Buffer): Buffer {
  return scryptSync(password.normalize("NFC"), salt, 32, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function sealSecrets(bundle: SecretBundle, password: string): Buffer {
  if (password.length < 8) throw new Error("Le mot de passe de sauvegarde doit faire au moins 8 caractères.");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(password, salt), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(bundle), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from(`${MAGIC}\n`), salt, iv, cipher.getAuthTag(), body]);
}

export function openSecrets(data: Buffer, password: string): SecretBundle {
  const header = Buffer.from(`${MAGIC}\n`);
  if (!data.subarray(0, header.length).equals(header)) throw new Error("Ce fichier n'est pas une sauvegarde de mots de passe de Jarvis.");
  let offset = header.length;
  const salt = data.subarray(offset, (offset += 16));
  const iv = data.subarray(offset, (offset += 12));
  const tag = data.subarray(offset, (offset += 16));
  const decipher = createDecipheriv("aes-256-gcm", key(password, salt), iv);
  decipher.setAuthTag(tag);
  try {
    const text = Buffer.concat([decipher.update(data.subarray(offset)), decipher.final()]).toString("utf8");
    return JSON.parse(text) as SecretBundle;
  } catch {
    throw new Error("Mot de passe de sauvegarde incorrect (ou fichier abîmé).");
  }
}

/** Fusionne les réglages restaurés dans jarvis.env : les valeurs du fichier restauré gagnent, sauf les vides. */
export function mergeEnvText(current: Record<string, string>, restored: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(restored)) if (v.trim() && current[k] !== v) out[k] = v;
  return out;
}
