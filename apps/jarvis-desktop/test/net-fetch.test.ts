import { describe, expect, it } from "vitest";
import { explainNetwork, resilientFetch } from "../src/main/net-fetch.js";

const netError = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: { code } });

describe("réseau des services en ligne", () => {
  it("retente par le réseau de Chromium quand fetch échoue", async () => {
    const calls: string[] = [];
    const primary = (async () => {
      calls.push("node");
      throw netError("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    }) as unknown as typeof fetch;
    const chromium = (async () => (calls.push("chromium"), new Response("{}"))) as unknown as typeof fetch;
    const res = await resilientFetch(primary, () => chromium, "Spotify")("https://api.spotify.com");
    expect(res.ok).toBe(true);
    expect(calls).toEqual(["node", "chromium"]);
  });

  it("explique l'échec en français au lieu de « fetch failed »", async () => {
    const failing = (async () => {
      throw netError("ENOTFOUND");
    }) as unknown as typeof fetch;
    await expect(resilientFetch(failing, () => undefined, "Spotify")("https://api.spotify.com")).rejects.toThrow("Spotify est injoignable : pas d'Internet");
    expect(explainNetwork(netError("UND_ERR_CONNECT_TIMEOUT"), "Spotify")).toContain("délai dépassé");
    expect(explainNetwork(netError("SELF_SIGNED_CERT_IN_CHAIN"), "Spotify")).toContain("antivirus");
  });

  it("ne touche pas aux réponses d'erreur du service", async () => {
    const primary = (async () => new Response("non", { status: 401 })) as unknown as typeof fetch;
    const res = await resilientFetch(primary, () => undefined, "Spotify")("https://api.spotify.com");
    expect(res.status).toBe(401);
  });
});
