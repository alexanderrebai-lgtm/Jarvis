import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ECRITURE_CHIFFRE, LECTURE_CHIFFRE, LECTURE_MAISON, MobileServer, canalAutorise, sessionCookie, type Niveau } from "../src/main/mobile.js";

const TOKEN = "0123456789abcdef0123456789abcdef";
const libre = (): Promise<number> =>
  new Promise((ok) => {
    const s = createServer().listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });

describe("jarvis mobile : droits par niveau", () => {
  it("les réglages et les connecteurs ne sont jamais accessibles, même au niveau chiffré", () => {
    for (const interdit of ["reglages:lire", "reglages:enregistrer", "reglages:action", "connecteurs:enregistrer", "connecteurs:tester", "connecteurs:supprimer", "connecteurs:approuver", "sante:optimiser", "sante:fermer", "projet:fichier", "disposition:appliquer", "diagnostic:run"]) {
      expect(canalAutorise(interdit, "chiffre"), interdit).toBeUndefined();
      expect(canalAutorise(interdit, "maison"), interdit).toBeUndefined();
    }
  });
  it("le réseau de la maison (clair) est en lecture limitée, sans aucune action", () => {
    for (const c of ECRITURE_CHIFFRE) expect(canalAutorise(c, "maison"), c).toBeUndefined();
    for (const c of LECTURE_CHIFFRE.filter((x) => !LECTURE_MAISON.includes(x))) expect(canalAutorise(c, "maison"), c).toBeUndefined(); // mémoire, journal, mails… pas en clair
    expect(canalAutorise("cout:lire", "maison")).toBe("lecture");
  });
  it("le réseau chiffré peut lire et agir", () => {
    expect(canalAutorise("memoire:lire", "chiffre")).toBe("lecture");
    expect(canalAutorise("tapo:toggle", "chiffre")).toBe("ecriture");
  });
});

describe("jarvis mobile : serveur", () => {
  let serveur: MobileServer | undefined;
  afterEach(() => serveur?.stop());

  async function demarre(over: Partial<ConstructorParameters<typeof MobileServer>[0]> = {}) {
    const dossier = mkdtempSync(path.join(tmpdir(), "mobile-"));
    writeFileSync(path.join(dossier, "mobile.html"), "<html>JARVIS MOBILE</html>");
    writeFileSync(path.join(dossier, "mobile.js"), "console.log(1)");
    writeFileSync(path.join(dossier, "manifest.webmanifest"), "{}");
    writeFileSync(path.join(dossier, "secret.txt"), "NE PAS SERVIR");
    const [pc, pm] = [await libre(), await libre()];
    const appels: Array<[string, unknown]> = [];
    const questions: Array<[string, Niveau]> = [];
    serveur = new MobileServer({
      token: TOKEN,
      ecoutes: [{ host: "127.0.0.1", port: pc, niveau: "chiffre" }, { host: "127.0.0.1", port: pm, niveau: "maison" }],
      dossier,
      invoke: async (c, p) => (appels.push([c, p]), { vu: c }),
      demander: async (t, n) => (questions.push([t, n]), `réponse à ${t}`),
      version: "9.9.9",
      ...over,
    });
    expect((await serveur.start()).ok).toBe(true);
    return { chiffre: `http://127.0.0.1:${pc}`, maison: `http://127.0.0.1:${pm}`, appels, questions };
  }
  const cookie = `jv=${sessionCookie(TOKEN)}`;
  const post = (url: string, chemin: string, corps: unknown, entetes: Record<string, string> = {}) =>
    fetch(`${url}${chemin}`, { method: "POST", headers: { "content-type": "application/json", cookie, ...entetes }, body: JSON.stringify(corps) });

  it("refuse tout sans jeton, mais publie le manifeste (nécessaire à « Ajouter à l'écran d'accueil »)", async () => {
    const s = await demarre();
    expect((await fetch(`${s.chiffre}/`)).status).toBe(401);
    expect((await fetch(`${s.chiffre}/mobile.js`)).status).toBe(401);
    expect((await fetch(`${s.chiffre}/api/etat`)).status).toBe(401);
    expect((await fetch(`${s.chiffre}/manifest.webmanifest`)).status).toBe(200);
  });

  it("échange le jeton de l'adresse contre un cookie HttpOnly et retire le jeton de l'adresse", async () => {
    const s = await demarre();
    const r = await fetch(`${s.chiffre}/?jeton=${TOKEN}`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/");
    const set = r.headers.get("set-cookie")!;
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Strict");
    expect(set).not.toContain(TOKEN); // le cookie n'est pas le jeton
    const page = await fetch(`${s.chiffre}/`, { headers: { cookie: set.split(";")[0]! } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("JARVIS MOBILE");
  });

  it("un mauvais jeton est refusé, puis la porte se ferme après trop d'essais", async () => {
    const s = await demarre();
    for (let i = 0; i < 8; i++) expect((await fetch(`${s.chiffre}/?jeton=faux${i}`)).status).toBe(401);
    expect((await fetch(`${s.chiffre}/?jeton=${TOKEN}`)).status).toBe(429); // même le bon jeton : trop d'essais
  });

  it("le niveau « maison » n'a ni actions ni données personnelles ; le niveau « chiffre » oui", async () => {
    const s = await demarre();
    expect((await post(s.maison, "/api/invoke", { canal: "tapo:toggle", payload: { nom: "salon", allume: true } })).status).toBe(403);
    expect((await post(s.maison, "/api/invoke", { canal: "memoire:lire" })).status).toBe(403);
    expect((await post(s.maison, "/api/invoke", { canal: "cout:lire" })).status).toBe(200);
    const r = await post(s.chiffre, "/api/invoke", { canal: "tapo:toggle", payload: { nom: "salon", allume: true } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, resultat: { vu: "tapo:toggle" } });
    expect(s.appels).toEqual([["cout:lire", undefined], ["tapo:toggle", { nom: "salon", allume: true }]]); // les refus n'ont rien appelé
  });

  it("n'ouvre jamais les réglages, même avec le bon jeton au niveau chiffré", async () => {
    const s = await demarre();
    const r = await post(s.chiffre, "/api/invoke", { canal: "reglages:lire" });
    expect(r.status).toBe(403);
    expect(s.appels).toHaveLength(0);
  });

  it("transmet les questions avec le niveau : questions seulement sur le réseau de la maison", async () => {
    const s = await demarre();
    expect(await (await post(s.chiffre, "/api/demander", { texte: "allume le salon" })).json()).toEqual({ ok: true, reponse: "réponse à allume le salon" });
    await post(s.maison, "/api/demander", { texte: "quelle heure ?" });
    expect(s.questions).toEqual([["allume le salon", "chiffre"], ["quelle heure ?", "maison"]]);
    expect((await post(s.chiffre, "/api/demander", { texte: "   " })).status).toBe(400);
  });

  it("une seule demande à la fois", async () => {
    let libere!: () => void;
    const s = await demarre({ demander: () => new Promise((r) => (libere = () => r("fini"))) });
    const premiere = post(s.chiffre, "/api/demander", { texte: "long" });
    await new Promise((r) => setTimeout(r, 50));
    expect((await post(s.chiffre, "/api/demander", { texte: "autre" })).status).toBe(429);
    libere();
    expect((await premiere).status).toBe(200);
  });

  it("refuse une requête venue d'un autre site, ou qui n'est pas du JSON", async () => {
    const s = await demarre();
    expect((await post(s.chiffre, "/api/invoke", { canal: "cout:lire" }, { origin: "https://site-malveillant.example" })).status).toBe(403);
    expect((await post(s.chiffre, "/api/invoke", { canal: "cout:lire" }, { origin: "null" })).status).toBe(403);
    expect((await fetch(`${s.chiffre}/api/invoke`, { method: "POST", headers: { cookie, "content-type": "text/plain" }, body: "x" })).status).toBe(415);
  });

  it("ne sert que les fichiers de la liste (pas de sortie du dossier)", async () => {
    const s = await demarre();
    const h = { cookie };
    expect((await fetch(`${s.chiffre}/secret.txt`, { headers: h })).status).toBe(404);
    expect((await fetch(`${s.chiffre}/..%2f..%2fetc%2fpasswd`, { headers: h })).status).toBe(404);
    expect((await fetch(`${s.chiffre}/mobile.js`, { headers: h })).status).toBe(200);
  });

  it("accepte l'en-tête x-jeton pour les outils, et refuse de démarrer avec un jeton trop court", async () => {
    const s = await demarre();
    expect((await fetch(`${s.chiffre}/api/etat`, { headers: { "x-jeton": TOKEN } })).status).toBe(200);
    expect(await (await fetch(`${s.chiffre}/api/etat`, { headers: { "x-jeton": TOKEN } })).json()).toEqual({ ok: true, niveau: "chiffre", version: "9.9.9" });
    const court = new MobileServer({ token: "abc", ecoutes: [], dossier: ".", invoke: async () => null, demander: async () => "" });
    expect((await court.start()).ok).toBe(false);
  });
});
