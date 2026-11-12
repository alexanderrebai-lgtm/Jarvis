/**
 * OBD-II avec un adaptateur ELM327 : codes défaut (mode 03 en cours, 07 en
 * attente), témoin moteur, et quelques mesures en direct (régime, température
 * d'eau, vitesse, charge, tension batterie…). Lecture seule, sauf l'effacement
 * des codes, qui demande l'accord d'Alex.
 */

/** Deux octets → code « P0133 ». */
export function decodeDtc(a: number, b: number): string {
  const letter = ["P", "C", "B", "U"][(a >> 6) & 0x03]!;
  const d1 = (a >> 4) & 0x03;
  const d2 = a & 0x0f;
  return `${letter}${d1}${d2.toString(16).toUpperCase()}${((b >> 4) & 0x0f).toString(16).toUpperCase()}${(b & 0x0f).toString(16).toUpperCase()}`;
}

/** Octets hexadécimaux d'une réponse ELM (en ignorant les en-têtes CAN « 7E8 », « SEARCHING… »). */
export function responseBytes(text: string): number[][] {
  return text
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^(SEARCHING|NO DATA|OK|ELM|\?|STOPPED|BUS INIT|UNABLE|CAN ERROR)/i.test(line))
    .map((line) => line.replace(/^[0-9A-F]{3}\s+(?=[0-9A-F]{2}\s)/i, "").replace(/^\d:\s*/, ""))
    .map((line) => (line.match(/[0-9A-F]{2}/gi) ?? []).map((h) => Number.parseInt(h, 16)));
}

/** Codes défaut d'une réponse au mode 03 (ou 07 / 0A). */
export function parseDtcResponse(text: string, mode = 0x43): string[] {
  const codes = new Set<string>();
  const lines = responseBytes(text);
  const flat = lines.flat();
  const start = flat.indexOf(mode);
  if (start === -1) return [];
  let bytes = flat.slice(start + 1);
  // En CAN, le premier octet donne le nombre de codes.
  const canCount = bytes[0];
  if (canCount !== undefined && bytes.length >= 1 + canCount * 2 && (bytes.length - 1) % 2 === 0 && canCount * 2 <= bytes.length - 1) {
    bytes = bytes.slice(1, 1 + canCount * 2);
  }
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    if (bytes[i] === 0 && bytes[i + 1] === 0) continue;
    if (bytes[i] === mode) continue;
    codes.add(decodeDtc(bytes[i]!, bytes[i + 1]!));
  }
  return [...codes];
}

export interface PidValue {
  pid: string;
  nom: string;
  valeur: number;
  unite: string;
}

export const PIDS: Record<string, { nom: string; unite: string; decode: (b: number[]) => number }> = {
  "0104": { nom: "Charge moteur", unite: "%", decode: ([a]) => (a! * 100) / 255 },
  "0105": { nom: "Température du liquide de refroidissement", unite: "°C", decode: ([a]) => a! - 40 },
  "010B": { nom: "Pression d'admission", unite: "kPa", decode: ([a]) => a! },
  "010C": { nom: "Régime moteur", unite: "tr/min", decode: ([a, b]) => (a! * 256 + b!) / 4 },
  "010D": { nom: "Vitesse", unite: "km/h", decode: ([a]) => a! },
  "010F": { nom: "Température d'air d'admission", unite: "°C", decode: ([a]) => a! - 40 },
  "0110": { nom: "Débit d'air", unite: "g/s", decode: ([a, b]) => (a! * 256 + b!) / 100 },
  "0111": { nom: "Position du papillon", unite: "%", decode: ([a]) => (a! * 100) / 255 },
  "012F": { nom: "Niveau de carburant", unite: "%", decode: ([a]) => (a! * 100) / 255 },
  "0142": { nom: "Tension du module de commande", unite: "V", decode: ([a, b]) => (a! * 256 + b!) / 1000 },
  "0146": { nom: "Température ambiante", unite: "°C", decode: ([a]) => a! - 40 },
  "015C": { nom: "Température d'huile", unite: "°C", decode: ([a]) => a! - 40 },
};

/** Valeur d'un PID (mode 01) dans une réponse « 41 0C 1A F8 ». */
export function parsePid(pid: string, text: string): PidValue | undefined {
  const def = PIDS[pid.toUpperCase()];
  if (!def) return undefined;
  const flat = responseBytes(text).flat();
  const code = Number.parseInt(pid.slice(2), 16);
  for (let i = 0; i + 1 < flat.length; i += 1) {
    if (flat[i] === 0x41 && flat[i + 1] === code) {
      const value = def.decode(flat.slice(i + 2, i + 4));
      if (Number.isFinite(value)) return { pid: pid.toUpperCase(), nom: def.nom, valeur: Math.round(value * 10) / 10, unite: def.unite };
    }
  }
  return undefined;
}

/** Témoin moteur et nombre de codes (PID 0101). */
export function parseMonitorStatus(text: string): { temoinMoteur: boolean; nombreCodes: number } | undefined {
  const flat = responseBytes(text).flat();
  for (let i = 0; i + 2 < flat.length; i += 1) {
    if (flat[i] === 0x41 && flat[i + 1] === 0x01) return { temoinMoteur: (flat[i + 2]! & 0x80) !== 0, nombreCodes: flat[i + 2]! & 0x7f };
  }
  return undefined;
}

export const ELM_INIT = ["ATZ", "ATE0", "ATL0", "ATS1", "ATH0", "ATSP0"];

/** Description courte des familles de codes (le détail, Claude le cherche pour le modèle exact). */
export function dtcFamily(code: string): string {
  const system = { P: "groupe motopropulseur", C: "châssis", B: "carrosserie", U: "réseau de communication" }[code[0] as "P" | "C" | "B" | "U"];
  const generic = code[1] === "0" || code[1] === "2" ? "code générique" : "code propre au constructeur";
  const sub: Record<string, string> = { "1": "dosage air/carburant", "2": "injection", "3": "allumage, ratés", "4": "antipollution", "5": "ralenti, vitesse", "6": "calculateur, sorties", "7": "boîte de vitesses", "8": "boîte de vitesses", "A": "hybride" };
  return `${system} (${generic}${code[0] === "P" && sub[code[2] ?? ""] ? `, ${sub[code[2]!]}` : ""})`;
}
