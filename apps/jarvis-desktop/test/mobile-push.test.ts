import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MobileServer, ECRITURE_CHIFFRE, LECTURE_CHIFFRE, LECTURE_MAISON, canalAutorise, sessionCookie } from "../src/main/mobile.js";
import { doitRenouveler, lireStatut, obtenirCertificat, type Execution } from "../src/main/tailscale.js";

const TOKEN = "0123456789abcdef0123456789abcdef";
const libre = (): Promise<number> =>
  new Promise((ok) => {
    const s = createServer().listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });

/** Certificat auto-signé pour « mon-pc.test.ts.net » (comme celui que Tailscale délivre, sans l'autorité). */
function certificat(jours = 90) {
  const d = mkdtempSync(path.join(tmpdir(), "cert-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", String(jours), "-subj", "/CN=mon-pc.test.ts.net", "-addext", "subjectAltName=DNS:mon-pc.test.ts.net,IP:127.0.0.1", "-keyout", path.join(d, "k.pem"), "-out", path.join(d, "c.pem")], { stdio: "ignore" });
  return { cert: readFileSync(path.join(d, "c.pem"), "utf8"), key: readFileSync(path.join(d, "k.pem"), "utf8") };
}

/** Requête HTTPS qui accepte le certificat auto-signé du test. */
function https(port: number, chemin: string, o: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; corps: string }> {
  return new Promise((resolve, reject) => {
    const r = httpsRequest({ host: "127.0.0.1", port, path: chemin, method: o.method ?? "GET", rejectUnauthorized: false, headers: { ...(o.body ? { "content-type": "application/json" } : {}), ...o.headers } }, (res) => {
      let corps = "";
      res.on("data", (c) => (corps += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, corps }));
    });
    r.on("error", reject);
    if (o.body) r.write(JSON.stringify(o.body));
    r.end();
  });
}

describe("jarvis mobile : HTTPS et notifications push", () => {
  async function demarre() {
    const dossier = mkdtempSync(path.join(tmpdir(), "mobile-push-"));
    writeFileSync(path.join(dossier, "mobile.html"), "<html>JARVIS</html>");
    writeFileSync(path.join(dossier, "sw.js"), "self.addEventListener('push', () => {});");
    const [ph, pm] = [await libre(), await libre()];
    const abonnes: unknown[] = [];
    const retires: string[] = [];
    const tls = certificat();
    const serveur = new MobileServer({
      token: TOKEN,
      ecoutes: [{ host: "127.0.0.1", port: ph, niveau: "chiffre", tls }, { host: "127.0.0.1", port: pm, niveau: "maison" }],
      dossier,
      invoke: async () => null,
      demander: async () => "",
      push: { cle: () => "CLE_VAPID_PUBLIQUE", abonner: (s) => (abonnes.push(s), typeof (s as { endpoint?: string })?.endpoint === "string"), desabonner: (e) => void retires.push(e) },
    });
    const r = await serveur.start();
    expect(r.ok).toBe(true);
    expect(r.message).toContain("HTTPS");
    return { serveur, https: ph, maison: `http://127.0.0.1:${pm}`, abonnes, retires };
  }
  const cookie = `jv=${sessionCookie(TOKEN)}`;
  const postMaison = (url: string, chemin: string, corps: unknown) => fetch(`${url}${chemin}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(corps) });

  it("sert l'application en HTTPS ; le cookie d'appairage est « Secure » ; le service worker est public", async () => {
    const s = await demarre();
    try {
      const pair = await https(s.https, `/?jeton=${TOKEN}`);
      expect(pair.status).toBe(302);
      const set = String(pair.headers["set-cookie"]);
      expect(set).toContain("Secure");
      expect(set).toContain("HttpOnly");
      expect((await https(s.https, "/", { headers: { cookie } })).status).toBe(200);
      const sw = await https(s.https, "/sw.js"); // sans cookie : public
      expect(sw.status).toBe(200);
      expect(String(sw.headers["content-type"])).toContain("javascript");
      expect((await https(s.https, "/api/etat")).status).toBe(401);
      const etat = JSON.parse((await https(s.https, "/api/etat", { headers: { cookie } })).corps);
      expect(etat).toMatchObject({ niveau: "chiffre", https: true, notifications: true });
    } finally {
      s.serveur.stop();
    }
  });

  it("les notifications ne sont proposées qu'à la connexion chiffrée : clé, abonnement, désabonnement", async () => {
    const s = await demarre();
    try {
      expect(JSON.parse((await https(s.https, "/api/push/cle", { headers: { cookie } })).corps)).toEqual({ ok: true, cle: "CLE_VAPID_PUBLIQUE" });
      const ab = await https(s.https, "/api/push/abonner", { method: "POST", headers: { cookie }, body: { subscription: { endpoint: "https://web.push.apple.com/x", keys: { p256dh: "a", auth: "b" } } } });
      expect(ab.status).toBe(200);
      expect(s.abonnes).toHaveLength(1);
      expect((await https(s.https, "/api/push/abonner", { method: "POST", headers: { cookie }, body: { subscription: { n: "importe quoi" } } })).status).toBe(400);
      await https(s.https, "/api/push/desabonner", { method: "POST", headers: { cookie }, body: { endpoint: "https://web.push.apple.com/x" } });
      expect(s.retires).toEqual(["https://web.push.apple.com/x"]);
      // Sur le Wi-Fi en clair : refusé, et le service d'abonnement n'est même pas appelé
      const appelsAvant = s.abonnes.length;
      expect((await fetch(`${s.maison}/api/push/cle`, { headers: { cookie } })).status).toBe(403);
      expect((await postMaison(s.maison, "/api/push/abonner", { subscription: { endpoint: "https://web.push.apple.com/x", keys: { p256dh: "a", auth: "b" } } })).status).toBe(403);
      expect(s.abonnes).toHaveLength(appelsAvant);
    } finally {
      s.serveur.stop();
    }
  });

  it("l'abonnement exige l'origine du serveur et du JSON, comme le reste", async () => {
    const s = await demarre();
    try {
      expect((await https(s.https, "/api/push/abonner", { method: "POST", headers: { cookie, origin: "https://pirate.example" }, body: { subscription: { endpoint: "https://web.push.apple.com/x" } } })).status).toBe(403);
      expect((await https(s.https, "/api/push/abonner", { method: "POST", headers: { "content-type": "text/plain" } })).status).toBe(401); // sans cookie d'abord
    } finally {
      s.serveur.stop();
    }
  });

  it("tester ses notifications est une action (niveau chiffré), l'état est une lecture ; rien en clair", () => {
    expect(canalAutorise("push:tester", "chiffre")).toBe("ecriture");
    expect(canalAutorise("push:etat", "chiffre")).toBe("lecture");
    expect(canalAutorise("push:tester", "maison")).toBeUndefined();
    expect(canalAutorise("push:etat", "maison")).toBeUndefined();
    expect(ECRITURE_CHIFFRE).toContain("push:tester");
    expect(LECTURE_CHIFFRE).toContain("push:etat");
    expect(LECTURE_MAISON).not.toContain("push:etat");
  });
});

describe("tailscale : certificat HTTPS", () => {
  const statut = (over: object = {}) => JSON.stringify({ BackendState: "Running", Self: { DNSName: "mon-pc.test.ts.net." }, CertDomains: ["mon-pc.test.ts.net"], ...over });

  it("lit le statut : domaines éligibles et état de la connexion", () => {
    expect(lireStatut(statut())).toEqual({ certDomains: ["mon-pc.test.ts.net"], actif: true, nom: "mon-pc.test.ts.net" });
    expect(lireStatut(statut({ CertDomains: null })).certDomains).toEqual([]);
    expect(lireStatut(statut({ CertDomains: ["evil.example.com"] })).certDomains).toEqual([]); // seulement *.ts.net
    expect(lireStatut(statut({ BackendState: "Stopped" })).actif).toBe(false);
    expect(lireStatut("pas du json")).toEqual({ certDomains: [], actif: false });
  });

  it("obtient le certificat et sa date de fin", async () => {
    const { cert, key } = certificat(60);
    const appels: string[][] = [];
    const exec = async (_p: string, args: string[]): Promise<Execution> => (appels.push(args), args[0] === "status" ? { code: 0, stdout: statut(), stderr: "" } : { code: 0, stdout: "", stderr: "" });
    const r = await obtenirCertificat({ exec, lire: async (f) => (f.endsWith(".crt") ? cert : key), dossier: "/tmp/ts" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.certificat.domaine).toBe("mon-pc.test.ts.net");
      expect(r.certificat.cert).toBe(cert);
      expect(r.certificat.expire - Date.now()).toBeGreaterThan(55 * 86_400_000);
      expect(r.certificat.expire - Date.now()).toBeLessThan(61 * 86_400_000);
    }
    expect(appels[1]).toEqual(["cert", "--cert-file", "/tmp/ts/tailscale.crt", "--key-file", "/tmp/ts/tailscale.key", "mon-pc.test.ts.net"]);
  });

  it("explique chaque cause d'échec en français", async () => {
    const lire = async () => "";
    const sans = (e: Partial<Execution>) => async () => ({ code: 0, stdout: statut(), stderr: "", ...e });
    expect(await obtenirCertificat({ exec: sans({ code: 1 }), lire, dossier: "." })).toEqual({ ok: false, raison: "Tailscale ne répond pas (installé et lancé sur ce PC ?)." });
    expect(await obtenirCertificat({ exec: sans({ stdout: statut({ BackendState: "Stopped" }) }), lire, dossier: "." })).toMatchObject({ ok: false, raison: expect.stringContaining("pas connecté") });
    expect(await obtenirCertificat({ exec: sans({ stdout: statut({ CertDomains: [] }) }), lire, dossier: "." })).toMatchObject({ ok: false, raison: expect.stringContaining("Enable HTTPS") });
    const echec = async (_p: string, args: string[]): Promise<Execution> => (args[0] === "status" ? { code: 0, stdout: statut(), stderr: "" } : { code: 1, stdout: "", stderr: "rate limited" });
    expect(await obtenirCertificat({ exec: echec, lire, dossier: "." })).toMatchObject({ ok: false, raison: expect.stringContaining("rate limited") });
    const illisible = async (_p: string, a: string[]): Promise<Execution> => ({ code: 0, stdout: a[0] === "status" ? statut() : "", stderr: "" });
    expect(await obtenirCertificat({ exec: illisible, lire: async () => "n'importe quoi", dossier: "." })).toMatchObject({ ok: false, raison: expect.stringContaining("illisible") });
  });

  it("renouvelle à moins de 20 jours de la fin", () => {
    const now = Date.now();
    expect(doitRenouveler(undefined, now)).toBe(true);
    expect(doitRenouveler({ domaine: "x", cert: "", key: "", expire: now + 10 * 86_400_000 }, now)).toBe(true);
    expect(doitRenouveler({ domaine: "x", cert: "", key: "", expire: now + 60 * 86_400_000 }, now)).toBe(false);
  });
});
