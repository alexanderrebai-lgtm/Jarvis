import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Vault } from "./vault.js";

/**
 * Connecteurs MCP : Alex branche des outils supplémentaires pour Claude
 * (Home Assistant, GitHub, Notion, un dossier, une base de données…) sans
 * nouvelle version de Jarvis. Chaque connecteur est soit un programme lancé
 * sur le PC (« commande »), soit une adresse web (« web »). Les jetons et
 * mots de passe vont au coffre-fort, jamais dans le fichier de réglages.
 */

export type ConnectorKind = "commande" | "web";

export interface Connector {
  nom: string;
  type: ConnectorKind;
  /** Pour « commande » : le programme et ses arguments. */
  commande?: string;
  arguments?: string[];
  /** Pour « web » : l'adresse du serveur MCP. */
  url?: string;
  actif: boolean;
  /** Noms des secrets enregistrés (variables d'environnement ou en-têtes), sans leurs valeurs. */
  secrets: string[];
  ajouteLe: string;
}

export interface ConnectorInput {
  nom: string;
  type: ConnectorKind;
  commande?: string;
  url?: string;
  /** « CLE=valeur » par ligne ; valeur vide = garder l'ancienne. */
  secrets?: string;
}

/** Préréglages proposés dans la page (à compléter par Alex). */
export const CONNECTOR_PRESETS: Array<{ nom: string; libelle: string; type: ConnectorKind; commande?: string; url?: string; secrets?: string; aide: string }> = [
  {
    nom: "home-assistant",
    libelle: "Home Assistant",
    type: "web",
    url: "http://homeassistant.local:8123/api/mcp",
    secrets: "Authorization=Bearer ",
    aide: "Dans Home Assistant : Paramètres → Appareils et services → ajouter « Model Context Protocol Server ». Puis Profil → Sécurité → jeton d'accès longue durée, à coller après « Bearer ».",
  },
  {
    nom: "github",
    libelle: "GitHub",
    type: "web",
    url: "https://api.githubcopilot.com/mcp/",
    secrets: "Authorization=Bearer ",
    aide: "Serveur MCP officiel de GitHub. Crée un jeton sur github.com → Settings → Developer settings → Personal access tokens, et colle-le après « Bearer ».",
  },
  {
    nom: "dossier",
    libelle: "Un dossier du PC",
    type: "commande",
    commande: "npx -y @modelcontextprotocol/server-filesystem C:\\Users\\Moi\\Documents",
    aide: "Donne à Claude l'accès à un dossier précis (remplace le chemin). Il faut Node.js installé (nodejs.org).",
  },
  {
    nom: "notion",
    libelle: "Notion",
    type: "web",
    url: "https://mcp.notion.com/mcp",
    secrets: "Authorization=Bearer ",
    aide: "Serveur MCP officiel de Notion. Crée une intégration sur notion.so/my-integrations, copie son jeton (« secret ») et colle-le après « Bearer ». Partage ensuite les pages voulues avec l'intégration.",
  },
  {
    nom: "memoire-ecran",
    libelle: "Mémoire de l'écran (Screenpipe)",
    type: "web",
    url: "http://localhost:3030/mcp",
    aide: "Screenpipe enregistre en local ce qui passe à l'écran et le rend consultable (« qu'est-ce que je regardais à 14 h ? »). Installe-le depuis screenpi.pe, puis active son serveur MCP. Tout reste sur le PC. Vérifie le port exact dans Screenpipe.",
  },
  {
    nom: "imprimante-3d",
    libelle: "Imprimante 3D Bambu Lab",
    type: "commande",
    commande: "npx -y bambu-mcp",
    secrets: "BAMBU_IP=\nBAMBU_SERIAL=\nBAMBU_ACCESS_CODE=",
    aide: "Pilote une Bambu Lab sur le réseau de la maison (état, pause, lumière). Mets l'imprimante en mode « LAN Only → Developer Mode », puis renseigne son adresse IP, son numéro de série et le code d'accès (écran de l'imprimante). Connecteur non officiel, à adapter selon le modèle.",
  },
  {
    nom: "voiture",
    libelle: "Voiture (via Home Assistant)",
    type: "web",
    url: "http://homeassistant.local:8123/api/mcp",
    secrets: "Authorization=Bearer ",
    aide: "La vraie façon de piloter une voiture connectée (verrouillage, climatisation, recharge, position) : branche d'abord ta marque dans Home Assistant (Renault, Tesla, BMW CarData, Stellantis…), puis Home Assistant ici. Pour le diagnostic moteur en direct, Jarvis a déjà la prise OBD (page mécanique).",
  },
];

const VAULT_PREFIX = "MCP:";

/** Découpe une ligne de commande en respectant les guillemets. */
export function splitCommand(line: string): string[] {
  return (line.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((part) => part.replace(/^["']|["']$/g, ""));
}

/** « CLE=valeur » par ligne → objet (lignes vides et commentaires ignorés). */
export function parseSecrets(text: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of (text ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

/** Nom utilisable par Claude (lettres, chiffres, tirets) ; « jarvis » et « jarvis_plus » sont réservés. */
export function connectorName(raw: string): string {
  const name = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!name) throw new Error("Donne un nom au connecteur.");
  if (name === "jarvis" || name === "jarvis_plus") throw new Error("Ce nom est réservé à Jarvis.");
  return name;
}

export type McpConfig =
  | { type: "stdio"; command: string; args: string[]; env?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> };

export class ConnectorStore {
  private readonly file: string;

  constructor(dataDir: string, private readonly vault: Vault) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, "connecteurs.json");
  }

  list(): Connector[] {
    if (!existsSync(this.file)) return [];
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as Connector[];
    } catch {
      return [];
    }
  }

  private write(all: Connector[]): void {
    writeFileSync(this.file, JSON.stringify(all, null, 1));
  }

  private secretsOf(nom: string): Record<string, string> {
    if (!this.vault.available) return {};
    return this.vault.getJson<Record<string, string>>(`${VAULT_PREFIX}${nom}`) ?? {};
  }

  save(input: ConnectorInput): Connector {
    const nom = connectorName(input.nom);
    if (input.type === "commande" && !input.commande?.trim()) throw new Error("Indique la commande à lancer.");
    if (input.type === "web" && !/^https?:\/\//i.test(input.url?.trim() ?? "")) throw new Error("L'adresse doit commencer par http:// ou https://.");
    const parts = input.type === "commande" ? splitCommand(input.commande!.trim()) : [];
    // Secrets : une valeur vide garde l'ancienne (on ne les réaffiche jamais).
    const previous = this.secretsOf(nom);
    const typed = parseSecrets(input.secrets);
    const secrets = { ...previous };
    for (const [k, v] of Object.entries(typed)) if (v && !/^Bearer\s*$/i.test(v)) secrets[k] = v;
    if (Object.keys(typed).length || Object.keys(previous).length) {
      if (!this.vault.available && Object.keys(secrets).length) throw new Error("Le coffre-fort n'est pas disponible : impossible de garder les jetons en sécurité.");
      if (this.vault.available) this.vault.setJson(`${VAULT_PREFIX}${nom}`, Object.keys(secrets).length ? secrets : undefined);
    }
    const all = this.list();
    const existing = all.find((c) => c.nom === nom);
    const connector: Connector = {
      nom,
      type: input.type,
      ...(input.type === "commande" ? { commande: parts[0]!, arguments: parts.slice(1) } : { url: input.url!.trim() }),
      actif: existing?.actif ?? true,
      secrets: Object.keys(secrets),
      ajouteLe: existing?.ajouteLe ?? new Date().toISOString(),
    };
    this.write([...all.filter((c) => c.nom !== nom), connector]);
    return connector;
  }

  setActive(nom: string, actif: boolean): boolean {
    const all = this.list();
    const c = all.find((x) => x.nom === nom);
    if (!c) return false;
    c.actif = actif;
    this.write(all);
    return true;
  }

  remove(nom: string): boolean {
    const all = this.list();
    if (!all.some((c) => c.nom === nom)) return false;
    this.write(all.filter((c) => c.nom !== nom));
    if (this.vault.available) this.vault.set(`${VAULT_PREFIX}${nom}`, undefined);
    return true;
  }

  config(c: Connector): McpConfig {
    const secrets = this.secretsOf(c.nom);
    if (c.type === "commande") return { type: "stdio", command: c.commande!, args: c.arguments ?? [], ...(Object.keys(secrets).length ? { env: { ...(process.env as Record<string, string>), ...secrets } } : {}) };
    return { type: "http", url: c.url!, ...(Object.keys(secrets).length ? { headers: secrets } : {}) };
  }

  /** Configuration des connecteurs actifs, pour le cerveau (relue à chaque conversation). */
  active(): Record<string, McpConfig> {
    return Object.fromEntries(this.list().filter((c) => c.actif).map((c) => [c.nom, this.config(c)]));
  }
}

/** Se connecte au serveur MCP et liste ses outils (bouton « Tester »). */
export async function testConnector(config: McpConfig, timeoutMs = 30_000): Promise<{ ok: boolean; message: string; outils: string[] }> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const client = new Client({ name: "jarvis", version: "1.0.0" });
  let transport: import("@modelcontextprotocol/sdk/shared/transport.js").Transport;
  if (config.type === "stdio") {
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    transport = new StdioClientTransport({ command: config.command, args: config.args, ...(config.env ? { env: config.env } : {}), stderr: "ignore" });
  } else {
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers ?? {} } });
  }
  const timer = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pas de réponse (délai dépassé)")), timeoutMs));
  try {
    await Promise.race([client.connect(transport), timer]);
    const { tools } = await Promise.race([client.listTools(), timer]);
    const names = tools.map((t) => t.name);
    return { ok: true, message: `Connecté : ${names.length} outil(s) disponible(s) pour Claude.`, outils: names };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const hint = /401|403|unauthori[sz]ed|forbidden/i.test(text)
      ? " Le jeton est refusé : vérifie-le (et « Bearer » devant)."
      : /ENOENT|not found|introuvable/i.test(text)
        ? " Le programme est introuvable : est-il installé (Node.js pour npx, Python pour uvx) ?"
        : /ECONNREFUSED|ENOTFOUND|fetch failed/i.test(text)
          ? " Le serveur ne répond pas à cette adresse."
          : "";
    return { ok: false, message: `Échec : ${text.slice(0, 200)}.${hint}`, outils: [] };
  } finally {
    await client.close().catch(() => undefined);
  }
}
