import { createHash } from "node:crypto";

/**
 * Garde des connecteurs MCP : empreinte des outils.
 *
 * Un connecteur sain peut devenir malveillant APRÈS que tu l'as approuvé : le
 * serveur change la description d'un outil (pour y glisser des instructions à
 * l'adresse de Claude) ou en ajoute un. C'est le « rug pull » décrit par la
 * recherche sur la sécurité de MCP, et c'est ce qui a touché les « skills »
 * d'OpenClaw. Parade : à la première connexion on retient une empreinte de
 * chaque outil (nom, description, paramètres) ; si elle change, le connecteur
 * est bloqué jusqu'à ce que tu relises et approuves.
 */

export interface ToolDef {
  name: string;
  description?: string | undefined;
  inputSchema?: unknown;
}

export type Empreintes = Record<string, string>;

export interface Difference {
  ajoutes: string[];
  retires: string[];
  modifies: string[];
}

/** JSON à clés triées : deux définitions identiques donnent toujours le même texte. */
function canonique(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonique).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonique(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function empreinteOutil(tool: ToolDef): string {
  return createHash("sha256")
    .update(canonique({ name: tool.name, description: tool.description ?? "", inputSchema: tool.inputSchema ?? null }))
    .digest("hex")
    .slice(0, 20);
}

export function empreintes(tools: ToolDef[]): Empreintes {
  return Object.fromEntries(tools.map((t) => [t.name, empreinteOutil(t)]));
}

export function comparer(ancien: Empreintes, nouveau: Empreintes): Difference {
  return {
    ajoutes: Object.keys(nouveau).filter((n) => !(n in ancien)).sort(),
    retires: Object.keys(ancien).filter((n) => !(n in nouveau)).sort(),
    modifies: Object.keys(nouveau).filter((n) => n in ancien && ancien[n] !== nouveau[n]).sort(),
  };
}

export function aChange(d: Difference): boolean {
  return d.ajoutes.length + d.retires.length + d.modifies.length > 0;
}

/** Explication en français de ce qui a changé. */
export function decrire(d: Difference): string {
  const bits: string[] = [];
  if (d.modifies.length) bits.push(`outil(s) modifié(s) : ${d.modifies.join(", ")}`);
  if (d.ajoutes.length) bits.push(`outil(s) ajouté(s) : ${d.ajoutes.join(", ")}`);
  if (d.retires.length) bits.push(`outil(s) retiré(s) : ${d.retires.join(", ")}`);
  return bits.join(" ; ");
}
