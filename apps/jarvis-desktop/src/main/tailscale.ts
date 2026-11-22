import { X509Certificate } from "node:crypto";

/**
 * Certificat HTTPS fourni par Tailscale pour l'adresse privée du PC
 * (« mon-pc.xxxx.ts.net »). Les notifications push d'un téléphone exigent HTTPS ;
 * Tailscale délivre ce certificat gratuitement, à condition d'avoir activé
 * « HTTPS » dans sa console d'administration (page DNS).
 */

export interface Execution {
  code: number;
  stdout: string;
  stderr: string;
}

export interface Certificat {
  domaine: string;
  cert: string;
  key: string;
  /** Fin de validité. */
  expire: number;
}

export type ResultatCertificat = { ok: true; certificat: Certificat } | { ok: false; raison: string };

/** Lit la sortie de « tailscale status --json » : domaines pour lesquels un certificat peut être délivré. */
export function lireStatut(json: string): { certDomains: string[]; actif: boolean; nom?: string } {
  try {
    const s = JSON.parse(json) as { BackendState?: string; CertDomains?: string[] | null; Self?: { DNSName?: string } };
    return { certDomains: (s.CertDomains ?? []).filter((d) => /^[a-z0-9.-]+\.ts\.net$/i.test(d)), actif: s.BackendState === "Running", ...(s.Self?.DNSName ? { nom: s.Self.DNSName.replace(/\.$/, "") } : {}) };
  } catch {
    return { certDomains: [], actif: false };
  }
}

export interface OptionsCertificat {
  exec: (programme: string, args: string[]) => Promise<Execution>;
  lire: (fichier: string) => Promise<string>;
  /** Dossier où Tailscale écrit le certificat et la clé. */
  dossier: string;
  programme?: string;
}

export async function obtenirCertificat(o: OptionsCertificat): Promise<ResultatCertificat> {
  const programme = o.programme ?? "tailscale";
  const statut = await o.exec(programme, ["status", "--json"]).catch((e) => ({ code: -1, stdout: "", stderr: String(e) }));
  if (statut.code !== 0) return { ok: false, raison: "Tailscale ne répond pas (installé et lancé sur ce PC ?)." };
  const s = lireStatut(statut.stdout);
  if (!s.actif) return { ok: false, raison: "Tailscale n'est pas connecté sur ce PC." };
  const domaine = s.certDomains[0];
  if (!domaine) return { ok: false, raison: "Le HTTPS n'est pas activé dans Tailscale : console d'administration → DNS → « Enable HTTPS »." };
  const cert = `${o.dossier}/tailscale.crt`;
  const key = `${o.dossier}/tailscale.key`;
  const r = await o.exec(programme, ["cert", "--cert-file", cert, "--key-file", key, domaine]).catch((e) => ({ code: -1, stdout: "", stderr: String(e) }));
  if (r.code !== 0) return { ok: false, raison: `Tailscale n'a pas pu délivrer le certificat : ${(r.stderr || r.stdout).trim().slice(0, 160)}` };
  const [certPem, keyPem] = await Promise.all([o.lire(cert), o.lire(key)]);
  try {
    return { ok: true, certificat: { domaine, cert: certPem, key: keyPem, expire: new Date(new X509Certificate(certPem).validTo).getTime() } };
  } catch {
    return { ok: false, raison: "Le certificat délivré par Tailscale est illisible." };
  }
}

/** Faut-il redemander un certificat ? Absent, ou à moins de 20 jours de la fin. */
export function doitRenouveler(c: Certificat | undefined, maintenant: number): boolean {
  return !c || c.expire - maintenant < 20 * 86_400_000;
}
