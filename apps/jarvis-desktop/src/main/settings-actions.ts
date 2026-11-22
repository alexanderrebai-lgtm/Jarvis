import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dialog, shell } from "electron";
import { parseDeviceList, realTapoDriver, TapoHome } from "@muscu/jarvis/src/tapo.js";
import { GOOGLE_SCOPES } from "@muscu/jarvis/src/google/client.js";
import { findClaudeExecutable } from "./brain.js";
import { isTelegramChatId, isTelegramToken } from "./phone.js";
import { parseCameras, rtspUrl } from "./security.js";
import { findTelegramChat, googleSignIn, parseEnv, updateEnvText } from "./settings.js";
import { openSecrets, mergeEnvText } from "./secret-backup.js";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { JarvisServices } from "./main.js";

/**
 * Boutons de la page Réglages : tester la météo, les ampoules, les caméras, Telegram ; connecter Google, Spotify, Claude ; installer la voix locale ; sauvegarder, restaurer, chercher une mise à jour.
 */

export type SettingActionsDeps = Pick<JarvisServices, "healthConnexion" | "satelliteConnexion" | "mobileLiens" | "mobileRenouveler" | "pushTesterMessage" | "agenda" | "backups" | "checkUpdates" | "conversation" | "env" | "envFile" | "handleCommand" | "host" | "localAI" | "localVoice" | "phone" | "planning" | "reply" | "say" | "settings" | "spotifyHelpers" | "tapo" | "tapoCache" | "vault" | "wake" | "weather" | "workspace">;

export function createSettingActions(d: SettingActionsDeps) {
  const { healthConnexion, satelliteConnexion, mobileLiens, mobileRenouveler, pushTesterMessage, agenda, backups, checkUpdates, conversation, env, envFile, handleCommand, host, localAI, localVoice, phone, planning, reply, say, settings, spotifyHelpers, tapo, tapoCache, vault, wake, weather, workspace } = d;
  /** Une image d'une caméra (pour le bouton « Tester »). */
  function grabCameraFrame(ip: string, user: string, password: string): Promise<string | undefined> {
    const bin = (ffmpegPath as unknown as string | null) ?? undefined;
    if (!bin) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const child = spawn(bin, ["-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-i", rtspUrl({ nom: "test", ip }, user, password, "basse"), "-frames:v", "1", "-f", "image2", "-vcodec", "mjpeg", "pipe:1"], { windowsHide: true });
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => child.kill(), 12_000);
      child.stdout.on("data", (d: Buffer) => chunks.push(d));
      child.on("close", () => {
        clearTimeout(timer);
        resolve(chunks.length ? `data:image/jpeg;base64,${Buffer.concat(chunks).toString("base64")}` : undefined);
      });
      child.on("error", () => resolve(undefined));
    });
  }

  async function runSettingAction(id: string): Promise<{ ok: boolean; message: string; images?: Array<{ nom: string; src: string }>; redemarrage?: boolean }> {
    try {
      switch (id) {
        case "meteo": {
          const w = await weather.setCity(env("JARVIS_VILLE"));
          return w ? { ok: true, message: `${w.ville} : ${w.maintenant.temperature} °C, ${w.maintenant.libelle.toLowerCase()}.` } : { ok: false, message: "Ville introuvable ou pas de réponse d'Open-Meteo." };
        }
        case "tapo": {
          if (!env("TAPO_EMAIL") || !env("TAPO_PASSWORD")) return { ok: false, message: "Renseigne l'e-mail et le mot de passe, puis enregistre." };
          const test = new TapoHome(realTapoDriver(env("TAPO_EMAIL")!, env("TAPO_PASSWORD")!, parseDeviceList(env("TAPO_DEVICES"))), { cacheFile: tapoCache, cacheKey: env("TAPO_EMAIL")!.toLowerCase() });
          // Liste déjà connue : on teste les appareils sans se reconnecter au compte TP-Link.
          if (!test.known || parseDeviceList(env("TAPO_DEVICES")).length) await test.refresh().catch((error: unknown) => {
            if (!test.known) throw error;
          });
          const states = await test.states();
          if (!states.length) return { ok: false, message: "Connexion faite, mais aucun appareil trouvé. Vérifie que le PC est sur le même réseau que tes ampoules, ou liste-les avec leur adresse IP." };
          const down = states.filter((d) => d.allume === null);
          const notFound = down.filter((d) => /introuvable sur le réseau|not found/i.test((d as { erreur?: string }).erreur ?? ""));
          const hint = !down.length
            ? ""
            : notFound.length === down.length
              ? ` ${down.map((d) => d.nom).join(", ")} : pas trouvé${down.length > 1 ? "s" : ""} sur le réseau de la maison. Vérifie qu'ils sont alimentés (interrupteur allumé), puis réessaie dans une minute. Si ça persiste, indique leur adresse IP dans « Appareils » (appli Tapo → appareil → roue dentée → Infos de l'appareil).`
              : " Injoignables en direct depuis le PC : dans l'appli Tapo, va dans Moi → Tapo Lab → « Compatibilité tierce » (Third-Party Compatibility) et active-la, puis réessaie. Vérifie aussi que le PC et les ampoules sont sur la même box (pas le Wi-Fi invité). Détail : " + down.map((d) => `${d.nom} : ${(d as { erreur?: string }).erreur ?? "pas de réponse"}`).join(" ; ");
          return { ok: down.length === 0, message: `${states.length} appareil(s) : ${states.map((d) => `${d.nom}${d.allume === null ? " (injoignable)" : d.allume ? " (allumé)" : " (éteint)"}`).join(", ")}.${hint}`, redemarrage: !tapo };
        }
        case "google": {
          if (!env("GOOGLE_CLIENT_ID") || !env("GOOGLE_CLIENT_SECRET")) return { ok: false, message: "Colle d'abord l'ID client et le code secret, puis enregistre." };
          const signed = await googleSignIn({ clientId: env("GOOGLE_CLIENT_ID")!, clientSecret: env("GOOGLE_CLIENT_SECRET")!, scopes: GOOGLE_SCOPES, open: (url) => void shell.openExternal(url) });
          settings.save({ GOOGLE_REFRESH_TOKEN: signed.refreshToken });
          return { ok: true, message: `Google est relié${signed.email ? ` (${signed.email})` : ""}. Redémarre Jarvis (bouton en haut) pour qu'il lise tes mails et ton agenda.`, redemarrage: true };
        }
        case "spotify":
          return { ok: true, message: await spotifyHelpers.connect() };
        case "planning": {
          const info = await planning.read();
          if (!info) return { ok: false, message: "Fichier introuvable. Choisis ton planning puis enregistre." };
          const next = info.horaires.filter((h) => h.date >= new Date().toISOString().slice(0, 10)).slice(0, 7);
          return info.horaires.length
            ? { ok: true, message: `${info.horaires.length} jour(s) lus (${info.methode}). Prochains : ${next.map((h) => `${new Date(`${h.date}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })} ${h.repos ? "repos" : `${h.debut ?? "?"}${h.fin ? `-${h.fin}` : ""}`}`).join(", ") || "aucun jour à venir"}.` }
            : { ok: false, message: "Je n'ai pas trouvé tes horaires dans ce fichier. Vérifie ton nom (champ « Ton nom tel qu'il est écrit »), ou décris les codes du planning." };
        }
        case "reveil":
          if (!wake) return { ok: false, message: "Le réveil est désactivé." };
          await wake.test();
          return { ok: true, message: "Le réveil sonne : dis « je suis debout »." };
        case "cameras": {
          const cams = parseCameras(env("TAPO_CAMERAS"));
          if (!cams.length) return { ok: false, message: "Ajoute au moins une caméra (nom=adresse IP), puis enregistre." };
          const images = await Promise.all(cams.map(async (c) => ({ nom: c.nom, src: (await grabCameraFrame(c.ip, env("TAPO_CAMERA_COMPTE") ?? "", env("TAPO_CAMERA_MOT_DE_PASSE") ?? "")) ?? "" })));
          const ok = images.filter((i) => i.src);
          return { ok: ok.length === cams.length, message: ok.length === cams.length ? "Toutes les caméras répondent." : `Sans réponse : ${images.filter((i) => !i.src).map((i) => i.nom).join(", ")} (adresse IP, identifiant ou mot de passe du compte caméra).`, images: ok, redemarrage: true };
        }
        case "telegram-chat": {
          if (!env("TELEGRAM_BOT_TOKEN")) return { ok: false, message: "Colle d'abord le jeton du bot (donné par @BotFather), puis enregistre." };
          if (!isTelegramToken(env("TELEGRAM_BOT_TOKEN"))) return { ok: false, message: "Ce n'est pas un jeton de bot : il ressemble à 123456789:AAH… (message de @BotFather après /newbot). Le nom qui finit par « _bot » ne suffit pas." };
          const chat = await findTelegramChat(env("TELEGRAM_BOT_TOKEN")!);
          if (!chat) return { ok: false, message: "Aucun message trouvé : envoie « bonjour » à ton bot dans Telegram, puis réessaie." };
          settings.save({ TELEGRAM_CHAT_ID: chat.id });
          return { ok: true, message: `Conversation trouvée${chat.nom ? ` (${chat.nom})` : ""} et enregistrée.` };
        }
        case "telegram":
          if (!phone.enabled) return { ok: false, message: "Il manque le jeton ou l'identifiant de conversation." };
          if (!isTelegramToken(env("TELEGRAM_BOT_TOKEN"))) return { ok: false, message: "Le jeton du bot n'a pas la bonne forme : il ressemble à 123456789:AAH… (message de @BotFather)." };
          if (!isTelegramChatId(env("TELEGRAM_CHAT_ID"))) return { ok: false, message: `« ${env("TELEGRAM_CHAT_ID")} » n'est pas l'identifiant de ta conversation (c'est un nombre, pas le nom du bot). Envoie « bonjour » à ton bot dans Telegram, puis clique sur « Trouver ma conversation » : Jarvis le remplit tout seul.` };
          await phone.text("Jarvis : essai des alertes. Si tu lis ceci, c'est relié.");
          return { ok: true, message: "Message d'essai envoyé sur ton téléphone." };
        case "voix":
          void handleCommand("apprends ma voix", "clavier");
          return { ok: true, message: "Répète les phrases que Jarvis te donne." };
        case "claude": {
          const exe = findClaudeExecutable();
          if (!exe) return { ok: false, message: "Le moteur Claude n'est pas dans cette version de Jarvis : installe la dernière version depuis l'onglet Releases du dépôt Jarvis." };
          if (process.platform !== "win32") return { ok: false, message: `Lance « ${exe} » dans un terminal pour te connecter.` };
          // Fenêtre de Claude Code : au premier lancement, il propose la connexion avec ton compte.
          spawn("cmd.exe", ["/c", "start", "Connexion à Claude", exe], { detached: true, stdio: "ignore", windowsHide: false }).unref();
          return { ok: true, message: "Une fenêtre noire s'ouvre : choisis un thème (Entrée), puis « Claude account with subscription », et valide dans le navigateur. Quand c'est fait, tape /exit dans la fenêtre, puis redémarre Jarvis." };
        }
        case "voix-locale-installer": {
          if (localVoice.installed) return { ok: true, message: "La voix locale est déjà installée. Choisis « Voix locale » dans Moteur de voix, enregistre, puis « Écouter un essai »." };
          host.notify("Voix locale", "Installation en cours : plusieurs Go à télécharger, 10 à 20 minutes. Je te préviens à la fin.");
          void localVoice.install().then((msg) => {
            host.notify("Voix locale", msg);
            reply(msg);
          });
          return { ok: true, message: "Installation lancée en arrière-plan (10 à 20 minutes, plusieurs Go). Je te préviens quand c'est fini. Ensuite : Moteur de voix → « Voix locale », Enregistrer, puis « Écouter un essai »." };
        }
        case "voix-essai": {
          const local = env("VOIX_MOTEUR") === "locale";
          if (local && !localVoice.installed) return { ok: false, message: "La voix locale n'est pas encore installée : clique sur « Installer la voix locale »." };
          const started = Date.now();
          say("Bonjour Alex. Il fait huit degrés, ton premier rendez-vous est à neuf heures, et j'ai pris la liberté de lancer le café. Façon de parler.");
          if (local) {
            const ok = await localVoice.start();
            return ok ? { ok: true, message: `Voix locale prête sur ${localVoice.device === "cuda" ? "la carte graphique" : "le processeur (lent)"} (${Math.round((Date.now() - started) / 1000)} s). Tu l'entends ?` } : { ok: false, message: `La voix locale ne démarre pas : ${localVoice.lastError ?? "erreur inconnue"}. Jarvis garde la voix en ligne en attendant.` };
          }
          return { ok: true, message: "Essai lancé avec la voix Microsoft en ligne." };
        }
        case "ollama": {
          const models = await localAI.models();
          return models.length ? { ok: true, message: `Modèles locaux : ${models.map((m) => m.nom).join(", ")}.` } : { ok: false, message: "Ollama répond mais n'a aucun modèle : « ollama pull qwen3:14b »." };
        }
        case "sauvegarde": {
          const r = await backups.run();
          if (!r) return { ok: true, message: "Une sauvegarde est déjà en cours." };
          const copy = env("SAUVEGARDE_MOT_DE_PASSE") ? " Tes mots de passe sont copiés, chiffrés, à côté." : " Ajoute un mot de passe de sauvegarde pour copier aussi tes mots de passe et connexions.";
          return { ok: true, message: `Sauvegarde faite : ${r.fichiers} fichiers dans ${r.fichier}.${copy}` };
        }
        case "restaurer-coffre": {
          const password = env("SAUVEGARDE_MOT_DE_PASSE");
          if (!password) return { ok: false, message: "Tape d'abord le mot de passe de sauvegarde (le même qu'avant), enregistre, puis recommence." };
          if (!vault.available) return { ok: false, message: "Le chiffrement de Windows n'est pas disponible : restauration impossible." };
          const chosen = await dialog.showOpenDialog({ title: "Fichier jarvis-coffre.chiffre", defaultPath: path.join(workspace, "sauvegardes"), filters: [{ name: "Copie des mots de passe", extensions: ["chiffre"] }], properties: ["openFile"] });
          const file = chosen.filePaths[0];
          if (chosen.canceled || !file) return { ok: false, message: "Aucun fichier choisi." };
          const bundle = openSecrets(readFileSync(file), password);
          for (const [key, value] of Object.entries(bundle.coffre)) vault.set(key, value);
          const changes = mergeEnvText(parseEnv(readFileSync(envFile, "utf8")), parseEnv(bundle.reglages));
          writeFileSync(envFile, updateEnvText(readFileSync(envFile, "utf8"), changes));
          return { ok: true, message: `Restauré : ${Object.keys(bundle.coffre).length} mot(s) de passe et connexions du ${new Date(bundle.date).toLocaleDateString("fr-FR")}. Redémarre Jarvis pour les utiliser.`, redemarrage: true };
        }
        case "mise-a-jour":
          return { ok: true, message: await checkUpdates() };
        case "sante-adresse": {
          const c = healthConnexion();
          if (!c.active) return { ok: false, message: "La réception est désactivée : mets « Oui » à « Recevoir mes données de santé », enregistre, puis redémarre Jarvis." };
          return { ok: true, message: `Jarvis a ouvert une « boîte aux lettres » sur ton PC. Adresse : ${c.url} — Code (à mettre dans l'en-tête « x-jeton ») : ${c.jeton}. Une appli du téléphone doit y déposer les données de ta montre : le guide pas à pas est sur la page « Ma forme ». Le téléphone doit être sur le même Wi-Fi que le PC.${c.urlDistante ? ` Hors de la maison (Tailscale) : ${c.urlDistante}.` : ""}` };
        }
        case "mobile-lien":
        case "mobile-telegram": {
          const c = mobileLiens();
          if (!c.actif) return { ok: false, message: "Jarvis Mobile est désactivé : mets « Oui » à « Activer Jarvis Mobile », enregistre, puis réessaie (pris en compte en moins d'une minute)." };
          if (!c.liens.length) return { ok: false, message: "Aucune adresse disponible. Installe Tailscale sur le PC et le téléphone (même compte) : c'est ce qui donne le contrôle complet. Ou autorise le Wi-Fi de la maison (lecture limitée), enregistre, et réessaie." };
          const texte = c.liens.map((l) => `${l.niveau === "chiffre" ? "🔒 Connexion chiffrée (Tailscale), contrôle complet" : "📶 Wi-Fi de la maison, lecture limitée"} :\n${l.url}`).join("\n\n");
          if (id === "mobile-lien") return { ok: true, message: `Ouvre ce lien sur ton téléphone (une seule fois) : ${c.liens.map((l) => l.url).join("  ·  ")}` };
          if (!phone.enabled) return { ok: false, message: "Configure d'abord Telegram (groupe « Alertes sur le téléphone ») : Jarvis s'en sert pour t'envoyer le lien. Sinon utilise « Voir le lien »." };
          await phone.text(`Jarvis Mobile — ouvre ce lien sur ton téléphone, une seule fois (puis « Partager » → « Sur l'écran d'accueil ») :\n\n${texte}\n\nNe le partage avec personne : il donne accès à Jarvis. Tu pourras le renouveler depuis les réglages.`);
          return { ok: true, message: "Lien envoyé sur Telegram. Ouvre-le sur le téléphone." };
        }
        case "mobile-push":
          return pushTesterMessage();
        case "mobile-renouveler":
          await mobileRenouveler();
          return { ok: true, message: "Nouveau jeton créé : les téléphones déjà appairés sont déconnectés. Envoie-toi le nouveau lien." };
        case "satellite-adresse": {
          const c = satelliteConnexion();
          if (!c.active) return { ok: false, message: "Les satellites sont désactivés : mets « Oui » à « Accepter les micros des autres pièces », enregistre, puis redémarre Jarvis." };
          return { ok: true, message: `Le micro envoie POST ${c.url} avec {"texte":"…","piece":"cuisine"} et l'en-tête x-jeton: ${c.jeton}. Il reçoit {"reponse":"…"} à dire. Droits : ${c.confiance === "proprietaire" ? "il peut agir comme toi" : "questions seulement"}.${c.urlDistante ? ` Hors de la maison (Tailscale) : ${c.urlDistante}.` : ""}` };
        }
      }
      return { ok: false, message: "Action inconnue." };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  return { runSettingAction };
}
