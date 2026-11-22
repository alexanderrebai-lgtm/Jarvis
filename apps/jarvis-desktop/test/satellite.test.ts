import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { adresseMaison, adresseTailscale, type Interfaces } from "../src/main/reseau.js";
import { SatelliteServer } from "../src/main/satellite.js";

const libre = (): Promise<number> =>
  new Promise((ok) => {
    const s = createServer().listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });

describe("adresses réseau", () => {
  const nets: Interfaces = {
    lo: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
    Ethernet: [{ family: "IPv6", internal: false, address: "fe80::1" }, { family: "IPv4", internal: false, address: "192.168.1.42" }],
    Tailscale: [{ family: "IPv4", internal: false, address: "100.101.102.103" }],
  };
  it("distingue la maison et Tailscale", () => {
    expect(adresseMaison(nets)).toBe("192.168.1.42");
    expect(adresseTailscale(nets)).toBe("100.101.102.103");
  });
  it("ne prend pas une adresse publique ou hors plage pour Tailscale", () => {
    expect(adresseTailscale({ a: [{ family: "IPv4", internal: false, address: "100.20.1.1" }, { family: "IPv4", internal: false, address: "100.200.1.1" }] })).toBeUndefined();
    expect(adresseMaison({ a: [{ family: "IPv4", internal: false, address: "8.8.8.8" }] })).toBeUndefined();
    expect(adresseTailscale({ a: [{ family: 4, internal: false, address: "100.64.0.1" }] })).toBe("100.64.0.1");
  });
});

describe("serveur satellite", () => {
  let serveur: SatelliteServer | undefined;
  afterEach(() => serveur?.stop());

  const demarre = async (repondre: (t: string, p?: string) => Promise<string>, token = "secret") => {
    const port = await libre();
    serveur = new SatelliteServer({ port, token, repondre });
    expect((await serveur.start()).ok).toBe(true);
    return `http://127.0.0.1:${port}`;
  };
  const post = (url: string, body: unknown, jeton?: string) =>
    fetch(`${url}/demande`, { method: "POST", headers: { "content-type": "application/json", ...(jeton ? { "x-jeton": jeton } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });

  it("refuse sans jeton ou avec un mauvais jeton", async () => {
    const url = await demarre(async () => "ne devrait jamais être appelé");
    expect((await post(url, { texte: "salut" })).status).toBe(401);
    expect((await post(url, { texte: "salut" }, "faux")).status).toBe(401);
  });

  it("transmet la phrase et la pièce, rend la réponse", async () => {
    let vu: [string, string | undefined] | undefined;
    const url = await demarre(async (t, p) => ((vu = [t, p]), "Il est midi."));
    const r = await post(url, { texte: "quelle heure est-il ?", piece: "cuisine" }, "secret");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ reponse: "Il est midi." });
    expect(vu).toEqual(["quelle heure est-il ?", "cuisine"]);
  });

  it("accepte aussi « text » et le jeton dans l'adresse, refuse le vide et le JSON cassé", async () => {
    const url = await demarre(async (t) => `ok:${t}`);
    const r = await fetch(`${url}/demande?jeton=secret`, { method: "POST", body: JSON.stringify({ text: "hello" }) });
    expect(await r.json()).toEqual({ reponse: "ok:hello" });
    expect((await post(url, { texte: "  " }, "secret")).status).toBe(400);
    expect((await post(url, "{pas du json", "secret")).status).toBe(400);
  });

  it("répond poliment quand le cerveau échoue, et refuse de démarrer sans jeton", async () => {
    const url = await demarre(async () => {
      throw new Error("boum");
    });
    const r = await post(url, { texte: "salut" }, "secret");
    expect(r.status).toBe(500);
    expect((await r.json() as { reponse: string }).reponse).toContain("pas pu répondre");
    const sans = new SatelliteServer({ port: await libre(), token: "", repondre: async () => "x" });
    expect((await sans.start()).ok).toBe(false);
  });
});
