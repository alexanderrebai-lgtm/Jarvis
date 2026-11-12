import { JsonStore } from "@muscu/jarvis/src/store.js";

/**
 * Pseudonymes pour le travail : avant d'envoyer un document ou une demande à
 * Claude, les noms des conseillers de l'équipe sont remplacés par
 * « Conseiller A », « Conseiller B »… ; la réponse est remise avec les vrais
 * noms sur le PC. Les alias restent les mêmes d'un jour à l'autre.
 */

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function letterCode(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Variante sans accents ni casse d'un nom, tolérante aux accents dans le texte. */
function accentInsensitive(name: string): string {
  const groups: Record<string, string> = { a: "[aàâäáã]", e: "[eéèêë]", i: "[iîïí]", o: "[oôöóõ]", u: "[uùûüú]", c: "[cç]", n: "[nñ]", y: "[yÿ]" };
  return [...fold(name)].map((ch) => groups[ch] ?? escapeRegex(ch)).join("");
}

export class Pseudonymizer {
  private readonly store: JsonStore<Record<string, { nom: string; alias: string }>>;

  constructor(dataDir: string, private readonly ownerNames: string[] = []) {
    this.store = new JsonStore(dataDir, "pseudonymes", () => ({}));
  }

  /** Ajoute des noms (planning, liste de l'équipe) ; chacun reçoit un alias stable. */
  learn(names: string[]): void {
    const owners = new Set(this.ownerNames.map(fold));
    const map = { ...this.store.read() };
    let changed = false;
    for (const raw of names) {
      const name = raw.replace(/\s+/g, " ").trim();
      if (name.length < 2 || owners.has(fold(name)) || [...owners].some((o) => fold(name).split(" ").includes(o))) continue;
      const key = fold(name);
      if (map[key]) continue;
      map[key] = { nom: name, alias: `Conseiller ${letterCode(new Set(Object.values(map).map((v) => v.alias)).size)}` };
      changed = true;
    }
    if (changed) this.store.write(map);
  }

  names(): string[] {
    return Object.values(this.store.read()).map((v) => v.nom);
  }

  private entries(): Array<{ name: string; alias: string; pattern: RegExp }> {
    const map = this.store.read();
    const out: Array<{ name: string; alias: string; pattern: RegExp }> = [];
    for (const { nom: name, alias } of Object.values(map)) {
      out.push({ name, alias, pattern: new RegExp(`(?<![\\p{L}\\p{N}])${accentInsensitive(name)}(?![\\p{L}\\p{N}])`, "giu") });
      // Le prénom seul (« Karim » pour « Karim Benali ») prend le même alias.
      const parts = name.split(" ");
      if (parts.length > 1 && parts[0]!.length >= 3) out.push({ name: parts[0]!, alias, pattern: new RegExp(`(?<![\\p{L}\\p{N}])${accentInsensitive(parts[0]!)}(?![\\p{L}\\p{N}])`, "giu") });
    }
    // Les noms complets d'abord, pour ne pas couper « Karim Benali » en « Conseiller A Benali ».
    return out.sort((a, b) => b.name.length - a.name.length);
  }

  /** Remplace les noms de l'équipe par leurs alias. */
  mask(text: string, extra: string[] = []): string {
    if (extra.length) this.learn(extra);
    let out = text;
    for (const e of this.entries()) out = out.replace(e.pattern, e.alias);
    return out;
  }

  /** Remet les vrais noms (avec leur écriture d'origine, prénom en majuscule). */
  unmask(text: string): string {
    const map = this.store.read();
    const byAlias = new Map<string, string>();
    for (const { nom, alias } of Object.values(map)) if (!byAlias.has(alias)) byAlias.set(alias, nom);
    return text.replace(/Conseill(?:er|ère)s? ([A-Z]{1,2})\b/g, (match, code: string) => byAlias.get(`Conseiller ${code}`) ?? match);
  }

  get size(): number {
    return Object.keys(this.store.read()).length;
  }
}
