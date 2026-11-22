import { createCipheriv, createDecipheriv, createECDH, createHmac, createPublicKey, createVerify, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PushService, webpush, type Abonnement, type ContenuPush } from "../src/main/push.js";

const dir = () => mkdtempSync(path.join(tmpdir(), "push-"));
const b64u = (b: Buffer) => b.toString("base64url");

/** Un « téléphone » : ses clés de réception, comme celles d'un navigateur abonné. */
function telephone(endpoint = "https://web.push.apple.com/AbCdEf123") {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, sub: { endpoint, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } } };
}

function service(contenu: ContenuPush = "discret", over: Partial<ConstructorParameters<typeof PushService>[0]> = {}) {
  let t = 1_000_000;
  const envoyes: Array<{ a: Abonnement; charge: any; o: { TTL: number; urgency: string } }> = [];
  const s = new PushService({
    dataDir: dir(),
    contenu: () => contenu,
    maintenant: () => t,
    envoi: async (a, charge, o) => (envoyes.push({ a, charge: JSON.parse(charge), o }), { statusCode: 201 }),
    ...over,
  });
  return { s, envoyes, avance: (ms: number) => (t += ms) };
}

describe("push : abonnements", () => {
  it("accepte les vrais services push, refuse tout le reste (jamais d'envoi vers une adresse quelconque)", () => {
    const { s } = service();
    const { sub } = telephone();
    expect(s.abonner(sub)).toBe(true);
    expect(s.abonner(telephone("https://fcm.googleapis.com/fcm/send/xyz").sub)).toBe(true);
    expect(s.abonner(telephone("https://updates.push.services.mozilla.com/wpush/v2/abc").sub)).toBe(true);
    expect(s.abonner(telephone("https://wns2-par02p.notify.windows.com/w/?token=abc").sub)).toBe(true);
    expect(s.abonner(telephone("http://web.push.apple.com/abc").sub)).toBe(false); // pas de HTTPS
    expect(s.abonner(telephone("https://pirate.example.com/collecte").sub)).toBe(false); // hôte inconnu
    expect(s.abonner(telephone("https://web.push.apple.com.pirate.example/abc").sub)).toBe(false);
    expect(s.abonner({ endpoint: "https://web.push.apple.com/x", keys: {} })).toBe(false);
    expect(s.abonner(null)).toBe(false);
    expect(s.nombre()).toBe(4);
  });

  it("un même téléphone ne s'ajoute pas deux fois, et le nombre d'appareils est limité", () => {
    const { s } = service();
    const t = telephone();
    s.abonner(t.sub);
    s.abonner(t.sub);
    expect(s.nombre()).toBe(1);
    for (let i = 0; i < 12; i++) s.abonner(telephone(`https://web.push.apple.com/appareil${i}`).sub);
    expect(s.nombre()).toBe(8);
    s.desabonner("https://web.push.apple.com/appareil11");
    expect(s.nombre()).toBe(7);
  });
});

describe("push : envoi", () => {
  it("contenu DISCRET par défaut : le titre part, pas le détail", async () => {
    const { s, envoyes } = service("discret");
    s.abonner(telephone().sub);
    const r = await s.envoyer({ titre: "Alerte surveillance", corps: "Personne détectée : caméra Entrée à 14:03", urgent: true });
    expect(r.envoyes).toBe(1);
    expect(envoyes[0]!.charge).toMatchObject({ titre: "Alerte surveillance", corps: "Ouvre Jarvis pour voir." });
    expect(JSON.stringify(envoyes[0]!.charge)).not.toContain("Entrée");
    expect(envoyes[0]!.o).toEqual({ TTL: 600, urgency: "high" });
  });

  it("contenu complet quand tu le choisis, rien du tout quand c'est désactivé", async () => {
    const complet = service("complet");
    complet.s.abonner(telephone().sub);
    await complet.s.envoyer({ titre: "Tâche terminée", corps: "Rapport prêt" });
    expect(complet.envoyes[0]!.charge.corps).toBe("Rapport prêt");
    expect(complet.envoyes[0]!.o).toEqual({ TTL: 3600, urgency: "normal" });
    const off = service("off");
    off.s.abonner(telephone().sub);
    expect((await off.s.envoyer({ titre: "x", corps: "y" })).envoyes).toBe(0);
    expect(off.envoyes).toHaveLength(0);
    expect((await off.s.envoyer({ titre: "Test", corps: "ça marche" }, { forcer: true })).envoyes).toBe(1); // le bouton « tester » passe toujours
  });

  it("ne renvoie pas la même notification deux fois en une minute", async () => {
    const { s, envoyes, avance } = service("complet");
    s.abonner(telephone().sub);
    await s.envoyer({ titre: "Mouvement", corps: "Entrée" });
    await s.envoyer({ titre: "Mouvement", corps: "Entrée" });
    expect(envoyes).toHaveLength(1);
    avance(61_000);
    await s.envoyer({ titre: "Mouvement", corps: "Entrée" });
    expect(envoyes).toHaveLength(2);
  });

  it("retire un téléphone qui n'existe plus (404 / 410) et rapporte les vraies erreurs", async () => {
    const codes: Record<string, number> = { "https://web.push.apple.com/mort": 410, "https://web.push.apple.com/vivant": 201, "https://web.push.apple.com/casse": 500 };
    const { s } = service("complet", { envoi: async (a) => ({ statusCode: codes[a.endpoint]! }) });
    for (const e of Object.keys(codes)) s.abonner(telephone(e).sub);
    const r = await s.envoyer({ titre: "x", corps: "y" });
    expect(r).toMatchObject({ envoyes: 1, retires: 1 });
    expect(r.erreurs).toEqual(["HTTP 500"]);
    expect(s.nombre()).toBe(2);
    const { s: s2 } = service("complet", { envoi: async () => Promise.reject(Object.assign(new Error("Gone"), { statusCode: 404 })) });
    s2.abonner(telephone().sub);
    expect((await s2.envoyer({ titre: "x", corps: "y" })).retires).toBe(1);
    expect(s2.nombre()).toBe(0);
  });
});

describe("push : clés", () => {
  it("garde les mêmes clés VAPID, et met la clé privée au coffre-fort quand il existe", () => {
    const d = dir();
    const coffre: Record<string, string> = {};
    const secret = { get: (k: string) => coffre[k], set: (k: string, v: string | undefined) => (v === undefined ? delete coffre[k] : (coffre[k] = v)) };
    const a = new PushService({ dataDir: d, contenu: () => "discret", secret });
    const cle = a.cle();
    expect(new PushService({ dataDir: d, contenu: () => "discret", secret }).cle()).toBe(cle);
    expect(coffre["push-vapid-prive"]).toBeTruthy();
    const fichiers = readdirSync(d).map((f) => readFileSync(path.join(d, f), "utf8")).join("\n");
    expect(fichiers).not.toContain(coffre["push-vapid-prive"]!); // la clé privée n'est pas dans le dossier de données
  });
});

/** Déchiffre un message Web Push (RFC 8291, aes128gcm) comme le fait le téléphone. */
function dechiffrer(corps: Buffer, ecdh: ReturnType<typeof createECDH>, auth: Buffer): string {
  const sel = corps.subarray(0, 16);
  const idLen = corps[20]!;
  const clePubExpediteur = corps.subarray(21, 21 + idLen);
  const chiffre = corps.subarray(21 + idLen);
  const secret = ecdh.computeSecret(clePubExpediteur);
  const hkdf = (cle: Buffer, info: Buffer, n: number) => createHmac("sha256", cle).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, n);
  const prkCle = createHmac("sha256", auth).update(secret).digest();
  const ikm = hkdf(prkCle, Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), clePubExpediteur]), 32);
  const prk = createHmac("sha256", sel).update(ikm).digest();
  const cek = hkdf(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(chiffre.subarray(chiffre.length - 16));
  const clair = Buffer.concat([d.update(chiffre.subarray(0, chiffre.length - 16)), d.final()]);
  let fin = clair.length;
  while (fin > 0 && clair[fin - 1] === 0) fin--;
  return clair.subarray(0, fin - 1).toString("utf8"); // on retire le délimiteur 0x02
}

describe("push : le vrai chiffrement (RFC 8291) et la signature VAPID", () => {
  it("le téléphone déchiffre exactement ce que le PC a envoyé, et la signature VAPID est valide", async () => {
    const tel = telephone();
    let requete: { headers: Record<string, string>; body: Buffer } | undefined;
    const { s } = service("complet", {
      envoi: async (a, charge, o) => {
        // Même appel que l'envoi réel, sans le réseau : on récupère la requête HTTP qui partirait chez Apple.
        const v = (s as unknown as { vapid: () => { publicKey: string; privateKey: string } }).vapid();
        const r = webpush.generateRequestDetails({ endpoint: a.endpoint, keys: a.keys }, charge, { TTL: o.TTL, urgency: o.urgency as "high" | "normal", vapidDetails: { subject: "mailto:jarvis-local@example.com", publicKey: v.publicKey, privateKey: v.privateKey } });
        requete = { headers: r.headers as Record<string, string>, body: r.body as Buffer };
        return { statusCode: 201 };
      },
    });
    s.abonner(tel.sub);
    await s.envoyer({ titre: "Alerte surveillance", corps: "Personne détectée à l'Entrée", tag: "cam1", urgent: true });
    expect(requete).toBeTruthy();
    expect(requete!.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(String(requete!.headers.TTL)).toBe("600");
    expect(requete!.headers.Urgency).toBe("high");
    // Le contenu du message déchiffré par le « téléphone »
    const clair = JSON.parse(dechiffrer(requete!.body, tel.ecdh, tel.auth));
    expect(clair).toEqual({ titre: "Alerte surveillance", corps: "Personne détectée à l'Entrée", url: "/", tag: "cam1" });
    // Et le service push ne voit pas le contenu en clair
    expect(requete!.body.toString("utf8")).not.toContain("Entrée");
    // Signature VAPID (JWT ES256) vérifiable avec la clé publique du PC
    const m = requete!.headers.Authorization!.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
    expect(m).toBeTruthy();
    const [, h, p, sig, k] = m!;
    const cle = Buffer.from(k!, "base64url");
    const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u(cle.subarray(1, 33)), y: b64u(cle.subarray(33, 65)) }, format: "jwk" });
    expect(createVerify("SHA256").update(`${h}.${p}`).verify({ key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(sig!, "base64url"))).toBe(true);
    const revendications = JSON.parse(Buffer.from(p!, "base64url").toString());
    expect(revendications.aud).toBe("https://web.push.apple.com");
    expect(revendications.sub).toBe("mailto:jarvis-local@example.com"); // aucune information personnelle
  });
});
