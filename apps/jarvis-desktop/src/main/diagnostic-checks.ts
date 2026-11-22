import { app } from "electron";
import { claudeLoginCheck, runChecks, type Check } from "./diagnostic.js";
import { describeProfile } from "./hardware.js";
import { explainGoogle } from "./settings.js";
import type { JarvisServices } from "./main.js";

/**
 * Bilan de santé de Jarvis : chaque organe (cerveau, voix, sens, services, maison, réveil, données, recherche, PC) est vérifié et un conseil est proposé.
 */

export type DiagnosticsDeps = Pick<JarvisServices, "localAI" | "ears" | "env" | "localVoice" | "voice" | "voiceLock" | "agenda" | "tapo" | "security" | "phone" | "spotify" | "planning" | "wake" | "backups" | "vault" | "lab" | "library" | "micro" | "perf" | "secretCopyDate" | "wakeWordStatus"> & {
  senses: () => JarvisServices["senses"];
  updateStatus: () => string;
  gpuPreferenceNote: () => string;
  hardware: () => JarvisServices["hardware"];
  tuning: () => JarvisServices["tuning"];
  movedSecrets: () => JarvisServices["movedSecrets"];
};

export function createDiagnostics(d: DiagnosticsDeps) {
  const { localAI, ears, env, localVoice, voice, voiceLock, agenda, tapo, security, phone, spotify, planning, wake, backups, vault, lab, library, micro, perf, secretCopyDate, wakeWordStatus, senses, updateStatus, gpuPreferenceNote, hardware, tuning, movedSecrets } = d;
  async function runDiagnostic() {
    const checks: Check[] = [
      { id: "claude", groupe: "Cerveau", titre: "Connexion à Claude", run: () => {
        const r = claudeLoginCheck();
        return r.etat === "ok" ? r : { ...r, conseil: "Réglages → Cerveau → « Se connecter à Claude ».", action: { libelle: "Se connecter à Claude", reglages: "cerveau" } };
      } },
      { id: "ia-locale", groupe: "Cerveau", titre: "IA locale (secours)", run: async () => {
        const models = await localAI.models().catch(() => undefined);
        if (!models?.length) return { etat: "absent", detail: "Ollama n'est pas installé ou n'a pas de modèle.", conseil: `Installe Ollama (ollama.com), puis « ollama pull ${tuning().ollamaConseille} » (taille adaptée à ta carte graphique) : Jarvis répondra même sans Internet.` };
        const vram = (hardware().nvidia?.vramMo ?? 0) / 1024;
        const tooBig = vram ? models.filter((m) => m.tailleGo > vram * 0.85 && !/embed/.test(m.nom)) : [];
        return { etat: tooBig.length === models.length ? "attention" : "ok", detail: `${models.length} modèle(s) : ${models.slice(0, 4).map((m) => m.nom).join(", ")}.${tooBig.length ? ` Trop gros pour ta carte graphique (lents) : ${tooBig.map((m) => m.nom).join(", ")}.` : ""}`, ...(tooBig.length === models.length ? { conseil: `Prends « ollama pull ${tuning().ollamaConseille} » : il tient entièrement dans la carte graphique.` } : {}) };
      } },
      { id: "materiel", groupe: "PC", titre: "Profil matériel", run: () => ({ etat: "ok", detail: `${describeProfile(hardware(), tuning())}${gpuPreferenceNote() ? ` · ${gpuPreferenceNote()}` : ""}.` }) },
      { id: "oreilles", groupe: "Voix", titre: "Reconnaissance vocale", run: () => (ears.loadError ? { etat: "erreur", detail: ears.loadError, conseil: "Vérifie la connexion (le modèle se télécharge au premier lancement)." } : { etat: ears.activeDevice ? "ok" : "attention", detail: `${ears.model} sur ${ears.activeDevice === "dml" ? "la carte graphique" : ears.activeDevice === "cpu" ? "le processeur" : "chargement…"}` }) },
      { id: "voix", groupe: "Voix", titre: "Voix de Jarvis", run: () => {
        if (env("VOIX_MOTEUR") === "locale") {
          if (!localVoice.installed) return { etat: "attention", detail: "Voix locale choisie mais pas installée : Jarvis parle avec la voix en ligne.", action: { libelle: "Installer la voix locale", reglages: "voix" } };
          return { etat: localVoice.status === "erreur" ? "erreur" : "ok", detail: `Voix locale ${localVoice.status === "prete" ? `prête (${localVoice.device === "cuda" ? "carte graphique" : "processeur"})` : localVoice.status === "erreur" ? `en erreur : ${localVoice.lastError ?? ""}` : "installée (démarre à la première phrase)"}.` };
        }
        return { etat: voice.mode === "en ligne" ? "ok" : "attention", detail: voice.mode === "en ligne" ? "Voix neuronale Microsoft en ligne." : `Voix de secours Windows (${voice.lastError ?? "voix en ligne injoignable"}).` };
      } },
      { id: "mot-eveil", groupe: "Voix", titre: "Mot d'éveil", run: () => {
        const w = wakeWordStatus();
        return { etat: w.actif ? "ok" : "attention", detail: w.detail, ...(w.actif ? {} : { action: { libelle: "Réglages de l'écoute", reglages: "voix" } }) };
      } },
    { id: "empreinte", groupe: "Voix", titre: "Verrou vocal", run: () => (voiceLock.enrolled ? { etat: "ok", detail: `Ta voix est enregistrée (seuil ${voiceLock.threshold}).` } : { etat: "attention", detail: "Pas d'empreinte : n'importe quelle voix peut commander Jarvis.", conseil: "Dis « Jarvis, apprends ma voix » et répète les cinq phrases.", action: { libelle: "Apprendre ma voix", commande: "apprends ma voix" } }) },
      { id: "micro", groupe: "Sens", titre: "Micro et caméras", run: () => ({ etat: senses().micro ? "ok" : "erreur", detail: `Micro ${senses().micro ? "actif" : "indisponible"} · ${senses().cameras} webcam(s) · gestes ${senses().gestes ? "actifs" : "inactifs"} · détecteur de personne ${senses().detecteur ? "prêt" : "non chargé"}`, ...(senses().micro ? {} : { conseil: "Paramètres Windows → Confidentialité → Microphone : autorise les applications de bureau." }) }) },
      { id: "google", groupe: "Services", titre: "Gmail et Agenda", run: async () => (agenda ? await agenda.list(new Date(), new Date(Date.now() + 3_600_000)).then(() => ({ etat: "ok" as const, detail: "Connecté." }), (error: unknown) => ({ etat: "erreur" as const, detail: explainGoogle(error instanceof Error ? error.message : String(error)), conseil: "Réglages → Gmail et Google Agenda → « Se connecter avec Google ».", action: { libelle: "Reconnecter Google", reglages: "google" } })) : { etat: "absent" as const, detail: "Non configuré.", conseil: "Page Réglages → Gmail et Google Agenda.", action: { libelle: "Relier Google", reglages: "google" } }) },
      { id: "tapo", groupe: "Maison", titre: "Ampoules et prises Tapo", run: async () => {
        if (!tapo) return { etat: "absent", detail: "Non configuré.", action: { libelle: "Relier Tapo", reglages: "tapo" } };
        const states = await tapo.states();
        const down = states.filter((s) => s.allume === null);
        return { etat: down.length ? "attention" : "ok", detail: `${states.length} appareil(s)${down.length ? `, injoignables : ${down.map((d) => d.nom).join(", ")}` : ""}` };
      } },
      { id: "cameras", groupe: "Maison", titre: "Caméras de surveillance", run: () => (security.enabled ? { etat: security.streams().every((s) => s.enDirect) ? "ok" : "attention", detail: security.streams().map((s) => `${s.nom} ${s.enDirect ? "en direct" : "hors ligne"}`).join(", ") } : { etat: "absent", detail: "Aucune caméra configurée.", action: { libelle: "Relier les caméras", reglages: "cameras" } }) },
      { id: "alertes", groupe: "Maison", titre: "Alertes sur le téléphone", run: () => (phone.enabled ? { etat: "ok", detail: "Telegram prêt." } : { etat: "absent", detail: "Pas d'alerte téléphone.", action: { libelle: "Relier Telegram", reglages: "alertes" } }) },
      { id: "spotify", groupe: "Réveil", titre: "Spotify", run: async () => {
        if (!spotify.configured) return { etat: "absent", detail: "Pas d'appli Spotify (SPOTIFY_CLIENT_ID).", conseil: "Crée l'appli sur developer.spotify.com, colle son Client ID dans les Réglages, puis « Connecter ».", action: { libelle: "Relier Spotify", reglages: "spotify" } };
        if (!spotify.connected) return { etat: "attention", detail: "Appli créée, compte pas encore relié.", action: { libelle: "Connecter Spotify", commande: "connecte Spotify" } };
        const devices = await spotify.devices();
        return { etat: "ok", detail: `Relié. Appareils : ${devices.map((d) => d.name).join(", ") || "aucun (ouvre l'appli Spotify)"}.` };
      } },
      { id: "planning", groupe: "Réveil", titre: "Planning de travail", run: async () => {
        if (!env("PLANNING_FICHIER")) return { etat: "absent", detail: "Pas de planning (PLANNING_FICHIER) : réveil à l'heure habituelle.", conseil: "Choisis ton fichier de planning dans les Réglages.", action: { libelle: "Choisir le planning", reglages: "reveil" } };
        const info = await planning.read();
        if (!info) return { etat: "erreur", detail: `Fichier introuvable : ${env("PLANNING_FICHIER")}` };
        return { etat: info.horaires.length ? "ok" : "attention", detail: `${info.horaires.length} jour(s) trouvés (${info.methode}).` };
      } },
      { id: "reveil", groupe: "Réveil", titre: "Prochain réveil", run: async () => {
        if (!wake) return { etat: "absent", detail: "Réveil désactivé (REVEIL=off)." };
        const next = await wake.refresh();
        return next ? { etat: "ok", detail: `${next.date} à ${next.heure} — ${next.raison}.` } : { etat: "attention", detail: "Aucun réveil dans les 8 jours." };
      } },
      { id: "sauvegardes", groupe: "Sécurité des données", titre: "Sauvegardes", run: () => (backups.last?.erreur ? { etat: "erreur", detail: backups.last.erreur } : backups.last ? { etat: "ok", detail: `Dernière : ${backups.last.date}.` } : { etat: "attention", detail: "Pas encore de sauvegarde (la première se fait cette nuit).", action: { libelle: "Sauvegarder maintenant", commande: "lance une sauvegarde" } }) },
      { id: "coffre-portable", groupe: "Sécurité des données", titre: "Copie des mots de passe", run: () => {
        if (!env("SAUVEGARDE_MOT_DE_PASSE")) return { etat: "attention", detail: "Pas de mot de passe de sauvegarde : après une réinstallation de Windows, il faudrait tout reconnecter.", action: { libelle: "Choisir un mot de passe", reglages: "sauvegardes" } };
        const date = secretCopyDate();
        return date ? { etat: "ok", detail: `Copie chiffrée du ${date} (avec chaque sauvegarde).` } : { etat: "attention", detail: "Mot de passe choisi, copie pas encore faite.", action: { libelle: "Sauvegarder maintenant", reglages: "sauvegardes" } };
      } },
      { id: "coffre", groupe: "Sécurité des données", titre: "Coffre-fort des mots de passe", run: () => (vault.available ? { etat: "ok", detail: `${vault.keys().length} secret(s) chiffré(s) par Windows${movedSecrets().length ? ` (déplacés de jarvis.env : ${movedSecrets().join(", ")})` : ""}.` } : { etat: "attention", detail: "Chiffrement indisponible : les mots de passe restent dans jarvis.env." }) },
      { id: "labo", groupe: "Recherche", titre: "Labo de calcul (Python)", run: async () => (lab.ready ? { etat: "ok", detail: "Environnement prêt." } : (await lab.findPython()) ? { etat: "attention", detail: "Python trouvé, labo pas encore préparé.", action: { libelle: "Préparer le labo", commande: "prépare le labo de calcul" } } : { etat: "absent", detail: "Python absent.", conseil: "winget install -e --id Python.Python.3.12" }) },
      { id: "bibliotheque", groupe: "Recherche", titre: "Bibliothèque", run: () => ({ etat: "ok", detail: `${library.status().documents} document(s), ${library.status().passages} passages${library.status().semantique ? ", recherche par le sens active" : ""}. Dossier : ${library.status().dossier}` }) },
      { id: "openalex", groupe: "Recherche", titre: "OpenAlex", run: () => (env("OPENALEX_CLE") ? { etat: "ok", detail: "Clé réglée." } : { etat: "absent", detail: "Sans clé, OpenAlex est ignoré (arXiv, Semantic Scholar et PubMed restent actifs).", action: { libelle: "Ajouter la clé", reglages: "cerveau" } }) },
      { id: "arduino", groupe: "Atelier", titre: "arduino-cli", run: async () => ((await micro.find()) ? { etat: "ok", detail: "Installé." } : { etat: "absent", detail: "Non installé.", conseil: "winget install -e --id ArduinoSA.CLI" }) },
      { id: "disque", groupe: "PC", titre: "Espace disque", run: async () => {
        const p = perf.current ?? (await perf.sample());
        const tight = p?.disques.filter((d) => d.utilisePct >= 90) ?? [];
        return { etat: tight.length ? "attention" : "ok", detail: tight.length ? `Presque plein : ${tight.map((d) => `${d.lecteur} (${d.utilisePct} %)`).join(", ")}` : "Assez d'espace." };
      } },
      { id: "version", groupe: "PC", titre: "Version et mises à jour", run: () => ({ etat: updateStatus().startsWith("Impossible") ? "attention" : "ok", detail: `Version ${app.getVersion()}${app.isPackaged ? "" : " (mode développement)"}. ${updateStatus()}`, action: { libelle: "Chercher une mise à jour", reglages: "sauvegardes" } }) },
    ];
    return runChecks(checks);
  }

  return { runDiagnostic };
}
