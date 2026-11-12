import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

/**
 * Navigateur web piloté par l'assistant (réservations, formulaires, comparaisons).
 * Le profil est conservé sur disque : une connexion à un site reste active.
 *
 * Garde-fous :
 * - un bouton qui engage (payer, réserver, commander, confirmer…) n'est cliqué
 *   qu'avec l'accord explicite de l'utilisateur ;
 * - aucun numéro de carte bancaire n'est saisi : l'utilisateur termine le paiement lui-même ;
 * - pas d'accès au réseau local du serveur.
 */

export interface PageSnapshot {
  url: string;
  titre: string;
  texte: string;
  elements: string[];
}

export const COMMITTING_LABEL =
  /(payer|paiement|pay\b|acheter|achat|commander|commande|checkout|order|book\b|réserver|reserver|réservation|reservation|confirmer|valider|souscrire|s'abonner|subscribe|purchase|buy\b|envoyer ma demande|terminer)/i;

const CARD_FIELD = /(cc-|card|carte|cvv|cvc|cryptogramme|expir|iban)/i;

function isPrivateAddress(address: string): boolean {
  if (address === "::1" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  const v4 = address.replace(/^::ffff:/, "");
  if (isIP(v4) !== 4) return false;
  const [a, b] = v4.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export async function checkPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Seules les adresses http(s) sont autorisées.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Adresse locale refusée.");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (addresses.some(isPrivateAddress)) throw new Error("Adresse du réseau local refusée.");
  return url;
}

export interface BrowserOptions {
  dataDir: string;
  executablePath?: string | undefined;
  /** Pour les tests uniquement : autorise les pages locales. */
  allowPrivate?: boolean;
}

export class WebBrowser {
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: BrowserOptions) {}

  /** Une seule opération à la fois sur le navigateur. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(task);
    this.queue = next;
    return next;
  }

  private async currentPage(): Promise<Page> {
    if (!this.context) {
      this.context = await chromium.launchPersistentContext(path.join(this.options.dataDir, "navigateur"), {
        headless: true,
        locale: "fr-FR",
        timezoneId: process.env.TZ ?? "Europe/Paris",
        viewport: { width: 1280, height: 900 },
        ...(this.options.executablePath ? { executablePath: this.options.executablePath } : {}),
      });
      this.context.on("close", () => {
        this.context = undefined;
        this.page = undefined;
      });
    }
    if (!this.page || this.page.isClosed()) {
      this.page = this.context.pages()[0] ?? (await this.context.newPage());
    }
    return this.page;
  }

  open(url: string): Promise<PageSnapshot> {
    return this.exclusive(async () => {
      if (!this.options.allowPrivate) await checkPublicUrl(url);
      const page = await this.currentPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await this.settle(page);
      return this.snapshot(page);
    });
  }

  read(): Promise<PageSnapshot> {
    return this.exclusive(async () => this.snapshot(await this.currentPage()));
  }

  click(ref: number, userConfirmed: boolean): Promise<PageSnapshot> {
    return this.exclusive(async () => {
      const page = await this.currentPage();
      const element = page.locator(`[data-jarvis-ref="${ref}"]`).first();
      if ((await element.count()) === 0) throw new Error(`Élément ${ref} introuvable : relis la page.`);
      const label = await element.evaluate((el) =>
        [el.textContent, el.getAttribute("aria-label"), el.getAttribute("value"), el.getAttribute("title")].filter(Boolean).join(" "),
      );
      if (COMMITTING_LABEL.test(label) && !userConfirmed) {
        throw new Error(
          `« ${label.trim().slice(0, 80)} » engage l'utilisateur (paiement, réservation ou envoi). Résume-lui ce qui va se passer (quoi, quand, prix) et attends son « oui » explicite, puis rappelle cet outil avec confirmation_utilisateur=true.`,
        );
      }
      await element.click({ timeout: 10_000 });
      await this.settle(page);
      return this.snapshot(page);
    });
  }

  fill(ref: number, text: string): Promise<PageSnapshot> {
    return this.exclusive(async () => {
      const page = await this.currentPage();
      const element = page.locator(`[data-jarvis-ref="${ref}"]`).first();
      if ((await element.count()) === 0) throw new Error(`Champ ${ref} introuvable : relis la page.`);
      const descriptor = await element.evaluate((el) =>
        [el.getAttribute("autocomplete"), el.getAttribute("name"), el.getAttribute("id"), el.getAttribute("placeholder"), el.getAttribute("aria-label")]
          .filter(Boolean)
          .join(" "),
      );
      if (CARD_FIELD.test(descriptor) || /\b(?:\d[ -]?){13,19}\b/.test(text)) {
        throw new Error("Je ne saisis jamais de données bancaires : l'utilisateur termine le paiement lui-même.");
      }
      const tag = await element.evaluate((el) => el.tagName.toLowerCase());
      if (tag === "select") await element.selectOption({ label: text }).catch(() => element.selectOption(text));
      else await element.fill(text, { timeout: 10_000 });
      return this.snapshot(page);
    });
  }

  press(key: string): Promise<PageSnapshot> {
    return this.exclusive(async () => {
      const page = await this.currentPage();
      await page.keyboard.press(key);
      await this.settle(page);
      return this.snapshot(page);
    });
  }

  screenshot(): Promise<string> {
    return this.exclusive(async () => {
      const page = await this.currentPage();
      return (await page.screenshot({ type: "jpeg", quality: 60 })).toString("base64");
    });
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    this.context = undefined;
    this.page = undefined;
  }

  private async settle(page: Page): Promise<void> {
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  }

  private async snapshot(page: Page): Promise<PageSnapshot> {
    const result = await page.evaluate(() => {
      const selector = "a[href], button, input, select, textarea, [role=button], [role=link], [role=option], [role=tab], [role=checkbox], [onclick]";
      const elements: string[] = [];
      let ref = 0;
      document.querySelectorAll("[data-jarvis-ref]").forEach((el) => el.removeAttribute("data-jarvis-ref"));
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden" || style.display === "none") continue;
        if (el instanceof HTMLInputElement && el.type === "hidden") continue;
        ref += 1;
        el.setAttribute("data-jarvis-ref", String(ref));
        const tag = el.tagName.toLowerCase();
        const kind =
          tag === "a" ? "lien" : tag === "select" ? "liste" : tag === "textarea" ? "zone de texte" : tag === "input" ? `champ ${(el as HTMLInputElement).type}` : "bouton";
        const label = (el.getAttribute("aria-label") || el.innerText || (el as HTMLInputElement).placeholder || el.getAttribute("title") || el.getAttribute("name") || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80);
        let extra = "";
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) extra = el.value ? ` = « ${el.value.slice(0, 40)} »` : "";
        if (el instanceof HTMLSelectElement) {
          const options = Array.from(el.options).map((o) => o.label).slice(0, 15).join(" | ");
          extra = ` (choix : ${options})`;
        }
        if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) extra = el.checked ? " [coché]" : " [non coché]";
        elements.push(`[${ref}] ${kind} « ${label} »${extra}`);
        if (ref >= 150) break;
      }
      return { titre: document.title, texte: document.body?.innerText ?? "", elements };
    });
    const texte = result.texte.replace(/\n{3,}/g, "\n\n").trim();
    return {
      url: page.url(),
      titre: result.titre,
      texte: texte.length > 6000 ? `${texte.slice(0, 6000)}\n[… page tronquée]` : texte,
      elements: result.elements,
    };
  }
}
