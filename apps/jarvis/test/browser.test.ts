import { existsSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { checkPublicUrl, WebBrowser } from "../src/browser.js";

// Le navigateur n'est pas installé partout (CI) : ces tests sont alors ignorés.
const executablePath = [process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium", chromium.executablePath()].find(
  (candidate): candidate is string => Boolean(candidate && existsSync(candidate)),
);

const PAGE = `<!doctype html><html><head><title>Chez Paul</title></head><body>
<h1>Réserver une table</h1>
<form onsubmit="event.preventDefault(); document.body.innerHTML = '<p>Réservation confirmée pour ' + document.getElementById('nom').value + '</p>'">
  <input id="nom" name="nom" placeholder="Votre nom">
  <select name="personnes"><option>1</option><option>2</option><option>4</option></select>
  <input name="cc-number" autocomplete="cc-number" placeholder="Numéro de carte">
  <button type="submit">Confirmer la réservation</button>
</form>
<a href="/menu">Voir le menu</a>
<div style="display:none"><button>Caché</button></div>
</body></html>`;

let server: Server;
let base: string;
let browser: WebBrowser;

beforeAll(async () => {
  if (!executablePath) return;
  server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(req.url === "/menu" ? "<title>Menu</title><p>Entrecôte 24 €</p>" : PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = new WebBrowser({
    dataDir: mkdtempSync(path.join(tmpdir(), "jarvis-nav-")),
    executablePath,
    allowPrivate: true,
  });
}, 30_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

describe.skipIf(!executablePath)("navigateur", () => {
  it("lit la page, remplit le formulaire et ne réserve qu'avec accord", async () => {
    const page = await browser.open(base);
    expect(page.titre).toBe("Chez Paul");
    expect(page.elements.join("\n")).not.toContain("Caché");
    const ref = (label: string) => Number(page.elements.find((e) => e.includes(label))!.match(/^\[(\d+)\]/)![1]);

    await browser.fill(ref("Votre nom"), "Alex");
    const after = await browser.fill(ref("liste"), "4");
    expect(after.elements.join("\n")).toContain("= « Alex »");

    await expect(browser.fill(ref("Numéro de carte"), "4111 1111 1111 1111")).rejects.toThrow(/bancaires/);
    await expect(browser.click(ref("Confirmer la réservation"), false)).rejects.toThrow(/engage l.utilisateur/);
    const done = await browser.click(ref("Confirmer la réservation"), true);
    expect(done.texte).toContain("Réservation confirmée pour Alex");
  }, 60_000);

  it("suit un lien sans demander d'accord", async () => {
    const page = await browser.open(base);
    const link = Number(page.elements.find((e) => e.includes("Voir le menu"))!.match(/^\[(\d+)\]/)![1]);
    const menu = await browser.click(link, false);
    expect(menu.texte).toContain("Entrecôte");
    expect((await browser.screenshot()).length).toBeGreaterThan(1000);
  }, 60_000);

});

describe("adresses autorisées", () => {
  it("refuse les adresses locales et les protocoles exotiques", async () => {
    await expect(checkPublicUrl("http://127.0.0.1:8787/sante")).rejects.toThrow(/local/);
    await expect(checkPublicUrl("http://192.168.1.10")).rejects.toThrow(/local/);
    await expect(checkPublicUrl("http://localhost")).rejects.toThrow(/locale/);
    await expect(checkPublicUrl("file:///etc/passwd")).rejects.toThrow(/http/);
  });
});
