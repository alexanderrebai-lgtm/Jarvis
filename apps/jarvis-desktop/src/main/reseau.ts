/**
 * Adresses réseau de ce PC : celle de la maison (Wi-Fi/câble) et, si Tailscale
 * est installé, celle du réseau privé chiffré qui relie ton téléphone à ton PC
 * de n'importe où (sans ouvrir de port sur ta box, sans cloud à nous).
 */

export type Interfaces = Record<string, Array<{ family: string | number; internal: boolean; address: string }> | undefined>;

const ipv4 = (n: { family: string | number }) => n.family === "IPv4" || n.family === 4;

/** Adresse de la maison : 10.x, 192.168.x ou 172.16–31.x. */
export function adresseMaison(nets: Interfaces): string | undefined {
  for (const list of Object.values(nets)) for (const n of list ?? []) if (ipv4(n) && !n.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address)) return n.address;
  return undefined;
}

/** Tailscale utilise la plage 100.64.0.0/10 (de 100.64 à 100.127). */
export function adresseTailscale(nets: Interfaces): string | undefined {
  for (const list of Object.values(nets)) for (const n of list ?? []) {
    const m = ipv4(n) && !n.internal ? n.address.match(/^100\.(\d{1,3})\./) : null;
    if (m && Number(m[1]) >= 64 && Number(m[1]) <= 127) return n.address;
  }
  return undefined;
}
