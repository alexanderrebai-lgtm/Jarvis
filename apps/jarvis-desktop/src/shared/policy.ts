/**
 * Autonomie de Jarvis. Alex veut qu'il agisse sans demander quand l'action
 * correspond à sa demande. Le modèle juge cette correspondance ; ce module fixe
 * les quelques limites dures que rien ne permet de franchir, même sur demande
 * vocale (une phrase mal entendue ne doit pas pouvoir effacer le disque).
 */

export interface PolicyDecision {
  allow: boolean;
  reason?: string;
}

const DESTRUCTIVE_COMMANDS: Array<[RegExp, string]> = [
  [/\bformat(\.com)?\s+[a-z]:/i, "formater un disque"],
  [/\bdiskpart\b/i, "modifier les partitions"],
  [/\b(clear-disk|initialize-disk|remove-partition|format-volume)\b/i, "effacer un disque"],
  [/\bbcdedit\b|\bbootrec\b/i, "modifier le démarrage de Windows"],
  [/\bvssadmin\b.*\bdelete\b|\bwbadmin\b.*\bdelete\b/i, "supprimer les sauvegardes"],
  [/\bcipher\b.*\/w/i, "effacer définitivement l'espace disque"],
  [/set-mppreference\b.*-disable|\bdisable-?windowsdefender|uninstall-windowsfeature.*defender/i, "désactiver l'antivirus"],
  [/netsh\s+advfirewall\s+set\s+\w+\s+state\s+off|set-netfirewallprofile\b.*-enabled\s+(false|0)/i, "désactiver le pare-feu"],
  [/\breg(\.exe)?\s+delete\s+hklm|remove-item\s+.*hklm:/i, "supprimer des clés système du registre"],
  [/\b(rm|del|rmdir|rd|remove-item|ri)\b[^|;&]*\s(-r\w*|\/s|-recurse)\b[^|;&]*\s["']?(?:[a-z]:\\?["']?\s*$|[a-z]:\\(windows|program files|programdata|users)\\?["']?\s*$|\/\s*$|~\s*$|\$env:userprofile\s*$)/i, "supprimer un disque ou un dossier système entier"],
  [/[a-z]:\\windows\\system32/i, "toucher aux fichiers système de Windows"],
  [/\b(takeown|icacls)\b.*[a-z]:\\windows/i, "changer les droits des fichiers système"],
  [/invoke-webrequest[^|]*\|\s*(iex|invoke-expression)|\biwr\b[^|]*\|\s*iex|curl[^|]*\|\s*(sh|bash)\b/i, "exécuter un script téléchargé sans le lire"],
];

const PROTECTED_PATHS = [/^[a-z]:\\windows\\/i, /^[a-z]:\\program files( \(x86\))?\\/i, /^[a-z]:\\programdata\\microsoft\\/i, /\\appdata\\roaming\\microsoft\\windows\\start menu\\programs\\startup\\/i];

const CARD_NUMBER = /\b(?:\d[ -]?){13,19}\b/;

function text(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? "");
}

export interface PolicyContext {
  /** « inconnu » : la voix n'est pas celle d'Alex (télé, invité) : questions seulement. */
  trust?: "proprietaire" | "inconnu";
  /** Dossier des documents de travail (noms des collègues) : lu seulement par travail_fichier_lire. */
  workFolder?: string | undefined;
}

/** Outils sans effet ni donnée privée, permis à une voix inconnue. */
const GUEST_TOOLS = new Set(["WebSearch", "WebFetch", "meteo", "course_etat", "litterature_chercher", "pc_performances", "ToolSearch"]);

/** Dossiers qu'on peut effacer sans corbeille (ils se régénèrent). */
const DISPOSABLE = /(node_modules|[\/]dist|^dist|[\/]build|^build|__pycache__|\.venv|[\/]venv|te?mp[\/"' ]|te?mp$|\.cache|[\/]release|\.pytest_cache|coverage|\$env:temp|%temp%|\.tmp|\.log)/i;

/** Commandes de suppression directes (Remove-Item, rm, del…) et leurs cibles. */
export function deletionTargets(command: string): string[] | undefined {
  let found: string[] | undefined;
  for (const segment of command.split(/[;\n|&]+/)) {
    const m = segment.trim().match(/^(?:sudo\s+)?(remove-item|rm|del|erase|rmdir|rd|ri)\b(.*)$/i);
    if (!m) continue;
    const args = (m[2] ?? "").match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    found = [...(found ?? []), ...args.filter((a) => !/^-|^\/[a-z]$/i.test(a)).map((a) => a.replace(/^["']|["']$/g, ""))];
  }
  return found;
}

/** Cible qu'on ne supprime jamais, même vers la corbeille : disque entier, Windows, Programmes, dossier personnel. */
export function protectedTarget(p: string): boolean {
  const t = p.trim().replace(/\//g, "\\").replace(/\\+$/, "");
  if (/^[a-z]:$/i.test(t) || t === "" || t === "~" || /^\$env:userprofile$/i.test(t)) return true;
  if (/^[a-z]:\\users\\[^\\]+$/i.test(t) || /^[a-z]:\\users$/i.test(t)) return true;
  if (/^[a-z]:\\users\\[^\\]+\\(documents|desktop|bureau|pictures|images|downloads|téléchargements|onedrive)$/i.test(t)) return true;
  return PROTECTED_PATHS.some((re) => re.test(`${t}\\`)) || /^[a-z]:\\(windows|program files|program files \(x86\)|programdata)$/i.test(t);
}

function normalizePath(p: string): string {
  return p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

export function decide(toolName: string, input: Record<string, unknown>, context: PolicyContext = {}): PolicyDecision {
  const name = toolName.replace(/^mcp__jarvis(_plus)?__/, "");

  if (context.trust === "inconnu" && !GUEST_TOOLS.has(name)) {
    return { allow: false, reason: "Bloqué : la voix qui a parlé n'est pas reconnue comme celle d'Alex. Avec une voix inconnue, je réponds aux questions générales mais je n'agis pas (PC, maison, mails, fichiers, surveillance) et je ne dévoile rien de privé. Dis-le poliment." };
  }

  if (context.workFolder) {
    const folder = normalizePath(context.workFolder);
    const target = normalizePath(text(input.file_path ?? input.path ?? input.notebook_path ?? input.command ?? input.script ?? ""));
    const readsWork = target.includes(folder) && (["Read", "Grep", "NotebookRead"].includes(name) || (["Bash", "PowerShell", "pc_powershell"].includes(name) && !/^\s*(get-childitem|dir|ls)\b[^;|&]*$/i.test(text(input.command ?? input.script))));
    if (readsWork) return { allow: false, reason: "Bloqué : les documents de travail contiennent les noms de l'équipe. Lis-les avec travail_fichier_lire (les noms y sont remplacés par des pseudonymes), et utilise travail_demasquer pour remettre les vrais noms dans un fichier que tu as produit." };
  }

  if (name === "Bash" || name === "PowerShell" || name === "pc_powershell") {
    const command = text(input.command ?? input.script);
    for (const [pattern, label] of DESTRUCTIVE_COMMANDS) {
      if (pattern.test(command)) {
        return { allow: false, reason: `Bloqué : cette commande pourrait ${label}. C'est une limite que je ne franchis pas, même sur demande. Propose à Alex de le faire lui-même s'il en a vraiment besoin.` };
      }
    }
    const targets = deletionTargets(command);
    if (targets && (targets.length === 0 || !targets.every((t) => DISPOSABLE.test(t)))) {
      return { allow: false, reason: "Bloqué : pour supprimer des fichiers, utilise l'outil fichier_corbeille : ils vont dans la corbeille de Windows et restent récupérables. (Les dossiers temporaires et de compilation comme node_modules, dist ou build peuvent être effacés directement.)" };
    }
  }

  if (name === "fichier_corbeille") {
    const paths = Array.isArray(input.chemins) ? (input.chemins as unknown[]).map(text) : [];
    const bad = paths.find((p) => protectedTarget(p));
    if (bad) return { allow: false, reason: `Bloqué : ${bad} est un disque, un dossier système ou ton dossier personnel entier. Je ne le mets pas à la corbeille.` };
  }

  if (name === "Write" || name === "Edit" || name === "MultiEdit" || name === "NotebookEdit") {
    const file = text(input.file_path ?? input.notebook_path);
    if (PROTECTED_PATHS.some((p) => p.test(file))) {
      return { allow: false, reason: `Bloqué : ${file} est un fichier système de Windows.` };
    }
  }

  if (name === "pc_clavier" && CARD_NUMBER.test(text(input.texte))) {
    return { allow: false, reason: "Bloqué : je ne tape jamais de numéro de carte bancaire. Alex termine le paiement lui-même." };
  }

  return { allow: true };
}
