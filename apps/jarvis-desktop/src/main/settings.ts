import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { SECRET_KEYS, VAULT_MARKER, type Vault } from "./vault.js";

/**
 * Réglages de Jarvis, modifiables depuis la page Réglages : chaque élément à
 * relier a ses champs, et les mots de passe vont directement dans le
 * coffre-fort. Les réglages qui ne peuvent pas changer à chaud sont signalés
 * (bouton « Redémarrer Jarvis »).
 */

export type FieldType = "texte" | "secret" | "fichier" | "dossier" | "nombre" | "heure" | "choix" | "liste";

export interface SettingField {
  cle: string;
  libelle: string;
  type: FieldType;
  aide?: string;
  exemple?: string;
  options?: Array<{ valeur: string; libelle: string }>;
  /** Le changement ne prend effet qu'après un redémarrage de Jarvis. */
  redemarrage?: boolean;
  filtres?: Array<{ name: string; extensions: string[] }>;
}

export interface SettingGroup {
  id: string;
  titre: string;
  description: string;
  champs: SettingField[];
  /** Boutons d'action proposés pour ce groupe. */
  actions?: Array<{ id: string; libelle: string }>;
  guide?: string;
}

export const SETTING_GROUPS: SettingGroup[] = [
  {
    id: "general",
    titre: "Toi et ta ville",
    description: "Ton prénom, ta ville (pour la météo) et ton fuseau horaire.",
    champs: [
      { cle: "OWNER_NAME", libelle: "Prénom", type: "texte", redemarrage: true },
      { cle: "JARVIS_VILLE", libelle: "Ville pour la météo", type: "texte", exemple: "Lyon" },
      { cle: "TZ", libelle: "Fuseau horaire", type: "texte", exemple: "Europe/Paris", redemarrage: true },
    ],
    actions: [{ id: "meteo", libelle: "Tester la météo" }],
  },
  {
    id: "tapo",
    titre: "Ampoules et prises Tapo",
    description: "Les identifiants de ton compte dans l'appli Tapo. Jarvis trouve ensuite tes appareils sur le réseau de la maison.",
    champs: [
      { cle: "TAPO_EMAIL", libelle: "E-mail du compte Tapo", type: "texte", redemarrage: true },
      { cle: "TAPO_PASSWORD", libelle: "Mot de passe Tapo", type: "secret", redemarrage: true },
      { cle: "TAPO_DEVICES", libelle: "Appareils (facultatif, si la recherche automatique ne les trouve pas)", type: "texte", exemple: "Lampe salon=192.168.1.20,Prise simulateur=192.168.1.21", redemarrage: true },
    ],
    actions: [{ id: "tapo", libelle: "Tester et lister mes appareils" }],
  },
  {
    id: "google",
    titre: "Gmail et Google Agenda",
    description: "Pour que Jarvis lise tes mails et ton agenda. Il faut une fois créer un « identifiant » Google (5 minutes), puis cliquer sur « Se connecter avec Google ».",
    guide:
      "1. Va sur console.cloud.google.com, crée un projet « Jarvis ».\n2. Menu → API et services → Bibliothèque : active « Gmail API » et « Google Calendar API ».\n3. Écran de consentement OAuth : type Externe, ajoute ton adresse comme utilisateur test.\n4. Identifiants → Créer → ID client OAuth → type « Application de bureau ».\n5. Copie l'ID client et le code secret ci-dessous, enregistre, puis clique sur « Se connecter avec Google ».",
    champs: [
      { cle: "GOOGLE_CLIENT_ID", libelle: "ID client OAuth", type: "texte", redemarrage: true },
      { cle: "GOOGLE_CLIENT_SECRET", libelle: "Code secret du client", type: "secret", redemarrage: true },
      { cle: "GOOGLE_REFRESH_TOKEN", libelle: "Autorisation (remplie par « Se connecter »)", type: "secret", redemarrage: true },
    ],
    actions: [{ id: "google", libelle: "Se connecter avec Google" }],
  },
  {
    id: "spotify",
    titre: "Spotify",
    description: "Pour la musique et le réveil. Crée ton appli sur developer.spotify.com (Redirect URI : http://127.0.0.1:8898/spotify, coche Web API), colle son Client ID, enregistre, puis « Connecter ».",
    champs: [
      { cle: "SPOTIFY_CLIENT_ID", libelle: "Client ID de ton appli Spotify", type: "texte", redemarrage: true },
      { cle: "SPOTIFY_REVEIL", libelle: "Playlist du réveil (lien, facultatif)", type: "texte", aide: "Vide : Jarvis crée « Réveil Jarvis »." },
    ],
    actions: [{ id: "spotify", libelle: "Connecter Spotify" }],
  },
  {
    id: "reveil",
    titre: "Réveil",
    description: "Le réveil suit ton planning de travail ; sans planning, l'heure habituelle les jours choisis.",
    champs: [
      { cle: "REVEIL", libelle: "Réveil", type: "choix", options: [{ valeur: "on", libelle: "Activé" }, { valeur: "off", libelle: "Désactivé" }], redemarrage: true },
      { cle: "PLANNING_FICHIER", libelle: "Planning de travail (Excel ou CSV)", type: "fichier", filtres: [{ name: "Planning", extensions: ["xlsx", "xlsm", "csv"] }] },
      { cle: "PLANNING_NOM", libelle: "Ton nom tel qu'il est écrit dans le planning (si différent)", type: "texte" },
      { cle: "PLANNING_CODES", libelle: "Codes du planning (facultatif)", type: "texte", exemple: "M=08:00-15:00,S=14:00-21:00", redemarrage: true },
      { cle: "REVEIL_AVANT_TRAVAIL", libelle: "Minutes entre le réveil et le début du poste", type: "nombre", exemple: "75" },
      { cle: "REVEIL_HEURE", libelle: "Heure habituelle (sans planning)", type: "heure", exemple: "07:45" },
      { cle: "REVEIL_JOURS", libelle: "Jours de l'heure habituelle", type: "texte", exemple: "lun-ven" },
      { cle: "REVEIL_LUMIERES", libelle: "Lampes du lever de soleil", type: "texte", exemple: "chambre" },
      { cle: "REVEIL_MUSIQUE_APRES", libelle: "Après le message du matin", type: "choix", options: [{ valeur: "continuer", libelle: "La musique continue doucement" }, { valeur: "pause", libelle: "La musique s'arrête" }] },
    ],
    actions: [{ id: "planning", libelle: "Lire le planning" }, { id: "reveil", libelle: "Essayer le réveil" }],
  },
  {
    id: "cameras",
    titre: "Caméras de surveillance Tapo",
    description: "Dans l'appli Tapo : caméra → Paramètres → Paramètres avancés → Compte de la caméra. Réserve une adresse IP fixe à chaque caméra dans ta box.",
    champs: [
      { cle: "TAPO_CAMERAS", libelle: "Caméras (nom=adresse IP)", type: "texte", exemple: "Entrée=192.168.1.30,Jardin=192.168.1.31", redemarrage: true },
      { cle: "TAPO_CAMERA_COMPTE", libelle: "Identifiant du compte caméra", type: "texte", redemarrage: true },
      { cle: "TAPO_CAMERA_MOT_DE_PASSE", libelle: "Mot de passe du compte caméra", type: "secret", redemarrage: true },
    ],
    actions: [{ id: "cameras", libelle: "Tester les caméras" }],
  },
  {
    id: "alertes",
    titre: "Alertes sur le téléphone (Telegram)",
    description: "Dans Telegram, écris à @BotFather « /newbot », copie le jeton. Envoie un message à ton bot, puis clique sur « Trouver ma conversation ».",
    champs: [
      { cle: "TELEGRAM_BOT_TOKEN", libelle: "Jeton du bot", type: "secret", redemarrage: true, aide: "Donné par @BotFather, il ressemble à 123456789:AAH…" },
      { cle: "TELEGRAM_CHAT_ID", libelle: "Identifiant de ta conversation", type: "texte", redemarrage: true, aide: "Un nombre, rempli tout seul par « Trouver ma conversation ». Pas le nom du bot." },
      { cle: "SURVEILLANCE_LUMIERES", libelle: "Lampes de dissuasion", type: "texte", exemple: "tout" },
      { cle: "SURVEILLANCE_DISSUASION", libelle: "Dissuasion (lumières et message)", type: "choix", options: [{ valeur: "true", libelle: "Oui" }, { valeur: "false", libelle: "Non" }] },
    ],
    actions: [{ id: "telegram-chat", libelle: "Trouver ma conversation" }, { id: "telegram", libelle: "Envoyer un essai" }],
  },
  {
    id: "voix",
    titre: "Voix et oreilles",
    description: "La voix de Jarvis, la reconnaissance vocale et le verrou vocal.",
    champs: [
      { cle: "VOIX_MOTEUR", libelle: "Moteur de voix", type: "choix", options: [{ valeur: "en-ligne", libelle: "Microsoft en ligne (gratuit, par défaut)" }, { valeur: "locale", libelle: "Voix locale sur la carte graphique (plus humaine)" }] },
      { cle: "VOIX_REFERENCE", libelle: "Voix locale : enregistrement de référence (10 à 20 s, WAV ou MP3)", type: "fichier", aide: "La voix locale imite le timbre de cet enregistrement : une voix française claire, sans musique. Vide : voix par défaut du modèle.", filtres: [{ name: "Audio", extensions: ["wav", "mp3", "flac"] }] },
      { cle: "VOIX_EXPRESSIVITE", libelle: "Voix locale : expressivité (0,3 calme à 0,8 très expressive)", type: "nombre", exemple: "0.5" },
      { cle: "JARVIS_VOICE", libelle: "Voix Microsoft", type: "choix", options: [{ valeur: "fr-FR-VivienneMultilingualNeural", libelle: "Vivienne (par défaut)" }, { valeur: "fr-FR-DeniseNeural", libelle: "Denise" }, { valeur: "fr-FR-EloiseNeural", libelle: "Éloïse" }], redemarrage: true },
      { cle: "JARVIS_VOICE_RATE", libelle: "Vitesse", type: "texte", exemple: "+5%", redemarrage: true },
      { cle: "STT_MODEL", libelle: "Reconnaissance vocale", type: "choix", options: [{ valeur: "auto", libelle: "Automatique (selon la carte graphique)" }, { valeur: "onnx-community/whisper-large-v3-turbo", libelle: "Large v3 turbo (précise)" }, { valeur: "onnx-community/whisper-small", libelle: "Small (équilibrée)" }, { valeur: "onnx-community/whisper-base", libelle: "Base (rapide)" }], redemarrage: true },
      { cle: "VOIX_SEUIL", libelle: "Sévérité du verrou vocal (0,80 à 0,92)", type: "nombre", exemple: "0.86" },
      { cle: "BOUTON_VOLANT_PARLER", libelle: "Bouton du volant pour parler (numéro)", type: "nombre" },
    ],
    actions: [{ id: "voix-locale-installer", libelle: "Installer la voix locale" }, { id: "voix-essai", libelle: "Écouter un essai" }, { id: "voix", libelle: "Apprendre ma voix" }],
  },
  {
    id: "travail",
    titre: "Travail",
    description: "Les noms de ton équipe sont remplacés par des pseudonymes avant d'aller vers Claude.",
    champs: [
      { cle: "TRAVAIL_DOSSIER", libelle: "Dossier des documents de travail", type: "dossier", redemarrage: true },
      { cle: "EQUIPE", libelle: "Noms de l'équipe (séparés par des virgules)", type: "liste", redemarrage: true },
    ],
  },
  {
    id: "cerveau",
    titre: "Cerveau et IA locale",
    description: "Sans clé API, Jarvis utilise ton abonnement Claude. Clique sur « Se connecter à Claude » : une fenêtre s'ouvre, choisis la connexion avec ton compte Claude et valide dans le navigateur. À faire une seule fois.",
    champs: [
      { cle: "ANTHROPIC_API_KEY", libelle: "Clé API Anthropic (facultatif, facturée à l'usage)", type: "secret", redemarrage: true },
      { cle: "OLLAMA_URL", libelle: "Adresse d'Ollama", type: "texte", exemple: "http://127.0.0.1:11434", redemarrage: true },
      { cle: "IA_LOCALE_MODELE", libelle: "Modèle local préféré", type: "texte", exemple: "qwen3:14b", redemarrage: true },
      { cle: "OPENALEX_CLE", libelle: "Clé OpenAlex (recherche scientifique)", type: "secret", redemarrage: true },
    ],
    actions: [{ id: "claude", libelle: "Se connecter à Claude" }, { id: "ollama", libelle: "Tester l'IA locale" }],
  },
  {
    id: "sauvegardes",
    titre: "Sauvegardes et mises à jour",
    description: "Une sauvegarde est faite chaque nuit dans Documents\\Jarvis\\sauvegardes ; tu peux en envoyer une copie ailleurs.",
    champs: [
      { cle: "SAUVEGARDE_COPIE", libelle: "Copie des sauvegardes (OneDrive, disque externe)", type: "dossier" },
      { cle: "MISE_A_JOUR_URL", libelle: "Adresse de mise à jour (vide : dépôt GitHub de Jarvis)", type: "texte", redemarrage: true },
    ],
    actions: [{ id: "sauvegarde", libelle: "Sauvegarder maintenant" }, { id: "mise-a-jour", libelle: "Chercher une mise à jour" }],
  },
];

const ALL_FIELDS = SETTING_GROUPS.flatMap((g) => g.champs);
const SECRET = new Set([...SECRET_KEYS, ...ALL_FIELDS.filter((f) => f.type === "secret").map((f) => f.cle)]);

/** Lit les valeurs d'un fichier .env (sans les commentaires). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Remplace ou ajoute des lignes dans le fichier .env en gardant les commentaires. */
export function updateEnvText(text: string, values: Record<string, string>): string {
  const lines = text.split(/\r?\n/);
  const done = new Set<string>();
  const next = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!m || !(m[1]! in values)) return line;
    done.add(m[1]!);
    return `${m[1]}=${values[m[1]!]}`;
  });
  const missing = Object.keys(values).filter((k) => !done.has(k));
  if (missing.length) next.push("", "# Ajouté depuis la page Réglages", ...missing.map((k) => `${k}=${values[k]}`));
  return next.join("\n");
}

export interface SettingsView {
  groupes: SettingGroup[];
  valeurs: Record<string, string>;
  /** Pour un secret : seulement s'il est enregistré (jamais sa valeur). */
  secrets: Record<string, boolean>;
  coffre: boolean;
}

export class SettingsStore {
  constructor(private readonly envFile: string, private readonly vault: Vault, private readonly env: NodeJS.ProcessEnv = process.env) {}

  view(): SettingsView {
    const file = existsSync(this.envFile) ? parseEnv(readFileSync(this.envFile, "utf8")) : {};
    const valeurs: Record<string, string> = {};
    const secrets: Record<string, boolean> = {};
    for (const f of ALL_FIELDS) {
      if (SECRET.has(f.cle)) secrets[f.cle] = Boolean(this.env[f.cle]?.trim() && this.env[f.cle] !== VAULT_MARKER) || Boolean(this.vault.available && this.vault.get(f.cle));
      else valeurs[f.cle] = file[f.cle] ?? this.env[f.cle] ?? "";
    }
    return { groupes: SETTING_GROUPS, valeurs, secrets, coffre: this.vault.available };
  }

  /**
   * Enregistre des réglages. Les secrets vont au coffre (jarvis.env garde
   * « @coffre ») ; un secret vide n'efface rien (sauf `effacer`).
   * Renvoie les clés qui demandent un redémarrage.
   */
  save(changes: Record<string, string>, clear: string[] = []): { enregistres: string[]; redemarrage: string[] } {
    const known = new Map(ALL_FIELDS.map((f) => [f.cle, f]));
    const fileValues: Record<string, string> = {};
    const saved: string[] = [];
    for (const [key, raw] of Object.entries(changes)) {
      const field = known.get(key);
      if (!field) continue;
      const value = raw.replace(/[\r\n]+/g, " ").trim();
      if (SECRET.has(key)) {
        if (!value) continue;
        if (this.vault.available) {
          this.vault.set(key, value);
          fileValues[key] = VAULT_MARKER;
        } else fileValues[key] = value;
      } else fileValues[key] = value;
      this.env[key] = value;
      saved.push(key);
    }
    for (const key of clear) {
      if (!known.has(key)) continue;
      if (this.vault.available) this.vault.set(key, undefined);
      fileValues[key] = "";
      delete this.env[key];
      saved.push(key);
    }
    const text = existsSync(this.envFile) ? readFileSync(this.envFile, "utf8") : "";
    writeFileSync(this.envFile, updateEnvText(text, fileValues));
    return { enregistres: saved, redemarrage: saved.filter((k) => known.get(k)?.redemarrage) };
  }
}

export const GOOGLE_REDIRECT_PORT = 8899;

/** Connexion Google pour une « application de bureau » : page Google dans le navigateur, retour sur 127.0.0.1. */
export async function googleSignIn(options: { clientId: string; clientSecret: string; scopes: string[]; open: (url: string) => void; fetchFn?: typeof fetch; timeoutMs?: number }): Promise<{ refreshToken: string; email?: string }> {
  const redirect = `http://127.0.0.1:${GOOGLE_REDIRECT_PORT}/google`;
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(12).toString("base64url");
  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", redirect);
      if (url.pathname !== "/google") return void res.writeHead(404).end();
      const ok = url.searchParams.get("state") === state && url.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<meta charset="utf-8"><body style="background:#020407;color:#cfefff;font:18px sans-serif;display:grid;place-items:center;height:90vh">${ok ? "Google est relié à Jarvis. Tu peux fermer cette page." : "La connexion a échoué. Réessaie depuis Jarvis."}</body>`);
      clearTimeout(timer);
      server.close();
      if (ok) resolve(url.searchParams.get("code")!);
      else reject(new Error(url.searchParams.get("error") ?? "connexion refusée"));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Pas de réponse de Google (délai dépassé)."));
    }, options.timeoutMs ?? 300_000);
    server.on("error", reject);
    server.listen(GOOGLE_REDIRECT_PORT, "127.0.0.1", () => {
      const params = new URLSearchParams({ client_id: options.clientId, redirect_uri: redirect, response_type: "code", scope: options.scopes.join(" "), access_type: "offline", prompt: "consent", state, code_challenge: challenge, code_challenge_method: "S256" });
      options.open(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    });
  });
  const res = await (options.fetchFn ?? fetch)("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: options.clientId, client_secret: options.clientSecret, redirect_uri: redirect, grant_type: "authorization_code", code_verifier: verifier }),
  });
  const data = (await res.json()) as { refresh_token?: string; access_token?: string; error?: string; error_description?: string };
  if (!data.refresh_token) throw new Error(`Google n'a pas donné d'autorisation (${data.error_description ?? data.error ?? res.status}).`);
  // Vérification immédiate : on lit l'adresse du compte Gmail relié.
  let email: string | undefined;
  if (data.access_token) {
    const profile = await (options.fetchFn ?? fetch)("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: `Bearer ${data.access_token}` } });
    const body = (await profile.json().catch(() => ({}))) as { emailAddress?: string; error?: { message?: string } };
    if (!profile.ok) throw new Error(`Connexion faite, mais Gmail refuse l'accès : ${body.error?.message ?? profile.status}. Vérifie que « Gmail API » est activée dans la console Google.`);
    email = body.emailAddress;
  }
  return { refreshToken: data.refresh_token, ...(email ? { email } : {}) };
}

/** Identifiant de la dernière conversation avec le bot Telegram. */
export async function findTelegramChat(token: string, fetchFn: typeof fetch = fetch): Promise<{ id: string; nom: string } | undefined> {
  const res = await fetchFn(`https://api.telegram.org/bot${token}/getUpdates`, { signal: AbortSignal.timeout(15_000) });
  const data = (await res.json()) as { ok: boolean; result?: Array<{ message?: { chat: { id: number; first_name?: string; username?: string } } }> };
  if (!data.ok) throw new Error("Telegram refuse le jeton du bot : recopie-le depuis @BotFather (il ressemble à 123456789:AAH…).");
  const chat = [...(data.result ?? [])].reverse().find((u) => u.message?.chat)?.message?.chat;
  return chat ? { id: String(chat.id), nom: chat.first_name ?? chat.username ?? "" } : undefined;
}
