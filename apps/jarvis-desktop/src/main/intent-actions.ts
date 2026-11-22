import { sayDuration, type Intent } from "../shared/intents.js";
import { procedurePrompt } from "./procedures.js";
import { sayTime } from "./reveil/schedule.js";
import type { JarvisServices } from "./main.js";

/**
 * Réflexes : les demandes simples (heure, lumières, musique, minuteurs, rappels, réveil, surveillance, ne pas déranger, mentor, voix, démonstrations, sauvegarde) sont exécutées tout de suite, sans passer par Claude.
 */

export type IntentActionsDeps = Pick<JarvisServices, "askBrain" | "backups" | "env" | "learning" | "notes" | "playWakePlaylist" | "procedures" | "reply" | "resetEnrollIndex" | "sendPageData" | "setFlag" | "setSurveillance" | "spotify" | "spotifyHelpers" | "tapo" | "timers" | "voiceLock" | "wake"> & {
  spotifyDevice: () => JarvisServices["spotifyDevice"];
};

export function createIntentActions(d: IntentActionsDeps) {
  const { askBrain, backups, env, learning, notes, playWakePlaylist, procedures, reply, resetEnrollIndex, sendPageData, setFlag, setSurveillance, spotify, spotifyHelpers, tapo, timers, voiceLock, wake, spotifyDevice } = d;
  async function runIntent(intent: Intent, trust: "proprietaire" | "inconnu"): Promise<boolean> {
    const guestOk = ["heure", "date", "minuteur", "minuteurs", "musique"].includes(intent.type) || (intent.type === "lumiere" && env("VOIX_INVITES_MAISON") === "true") || (intent.type === "reveil" && ["debout", "repousser", "quand"].includes(intent.action));
    if (trust === "inconnu" && !guestOk) {
      reply("Je ne reconnais pas ta voix : je ne peux pas faire ça.");
      return true;
    }
    try {
      switch (intent.type) {
        case "heure":
          reply(`Il est ${sayTime(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }))}.`);
          return true;
        case "date":
          reply(`Nous sommes le ${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`);
          return true;
        case "lumiere": {
          if (!tapo) return false;
          const results = await tapo.command(intent.cible, { ...(intent.action ? { action: intent.action } : {}), ...(intent.luminosite ? { luminosite: intent.luminosite } : {}), ...(intent.couleur ? { couleur: intent.couleur } : {}) });
          const failed = results.filter((r) => !r.ok);
          reply(failed.length ? `${failed.map((f) => f.nom).join(", ")} ne répond pas.` : "C'est fait.");
          void sendPageData("accueil");
          return true;
        }
        case "musique": {
          if (!spotify.connected) {
            reply("Spotify n'est pas encore relié. Dis « connecte Spotify ».");
            return true;
          }
          if (intent.action === "reveil") reply(await playWakePlaylist());
          else if (intent.action === "lecture") reply(await spotifyHelpers.play(intent.requete));
          else if (intent.action === "volume") {
            const current = intent.delta ? ((await spotify.current().catch(() => undefined))?.volume ?? 50) : 0;
            await spotify.volume(intent.volume ?? current + (intent.delta ?? 0), spotifyDevice());
          } else await spotifyHelpers.control(intent.action === "suivant" ? "suivant" : intent.action === "precedent" ? "precedent" : "pause");
          return true;
        }
        case "minuteur":
          timers.add(intent.secondes, intent.libelle);
          reply(`Minuteur de ${sayDuration(intent.secondes)}${intent.libelle ? ` pour ${intent.libelle}` : ""}.`);
          return true;
        case "minuteur_annuler":
          reply(timers.cancelAll() ? "Minuteur annulé." : "Aucun minuteur en cours.");
          return true;
        case "minuteurs": {
          const list = timers.list();
          reply(list.length ? list.map((t) => `${t.libelle ? `${t.libelle} : ` : ""}encore ${sayDuration(t.resteSecondes)}`).join(". ") : "Aucun minuteur en cours.");
          return true;
        }
        case "rappel":
          notes.add(intent.texte, ["rappel"], new Date(Date.now() + intent.dans * 1000).toISOString());
          reply(`Je te le rappelle dans ${sayDuration(intent.dans)}.`);
          return true;
        case "reveil":
          return runAlarmIntent(intent);
        case "surveillance":
          setSurveillance(intent.mode);
          reply({ off: "Surveillance désactivée.", simple: "Surveillance activée.", complete: "Surveillance complète. Je ne quitte pas les caméras des yeux." }[intent.mode]);
          return true;
        case "ne_pas_deranger":
          setFlag("doNotDisturb", intent.actif);
          reply(intent.actif ? "Je me fais discrète." : "Je suis de nouveau là.");
          return true;
        case "mentor":
          learning.setMode(intent.mode);
          reply({ fais: "D'accord, je fais à ta place.", avec: "D'accord, on le fait ensemble, étape par étape.", guide: "D'accord. Je te guide, mais c'est toi qui fais." }[intent.mode]);
          void sendPageData("accueil");
          return true;
        case "voix":
          if (intent.action === "apprendre") {
            const phrases = voiceLock.startEnrollment();
            reply(`D'accord. Répète après moi, une phrase à la fois, sans dire « Jarvis » avant. Première phrase : ${phrases[0]}`);
            resetEnrollIndex();
          } else if (intent.action === "oublier") {
            voiceLock.forget();
            reply("J'ai oublié ta voix. N'importe qui peut à nouveau me commander.");
          } else reply(voiceLock.enrolled ? "Oui, je connais ta voix." : "Pas encore. Dis « apprends ma voix ».");
          return true;
        case "spotify":
          reply("J'ouvre la page de connexion Spotify dans ton navigateur.");
          reply(await spotifyHelpers.connect());
          return true;
        case "demonstration":
          if (intent.action === "debut") {
            const name = intent.nom || `procédure du ${new Date().toLocaleDateString("fr-FR")}`;
            procedures.start(name);
            reply(`Je regarde. Montre-moi comment ${name}, et commente si tu veux. Dis « c'est fini » quand tu as terminé.`);
          } else {
            const rec = procedures.stop();
            if (!rec) {
              reply("Je n'enregistrais rien.");
              return true;
            }
            reply("C'est noté. J'écris la procédure.");
            void askBrain(procedurePrompt(rec), "clavier", "proprietaire");
          }
          return true;
        case "sauvegarde":
          reply("Je lance la sauvegarde.");
          void backups.run().then((r) => r && reply(`Sauvegarde terminée : ${r.fichiers} fichiers.`)).catch((e) => reply(`La sauvegarde a échoué : ${e instanceof Error ? e.message : e}.`));
          return true;
      }
    } catch (error) {
      reply(`Je n'y arrive pas : ${error instanceof Error ? error.message : String(error)}`);
      return true;
    }
    return false;
  }

  async function runAlarmIntent(intent: Extract<Intent, { type: "reveil" }>): Promise<boolean> {
    if (!wake) {
      reply("Le réveil est désactivé dans les réglages (REVEIL=off).");
      return true;
    }
    switch (intent.action) {
      case "debout":
        if (!(await wake.confirmAwake())) reply("Je ne sonnais pas, mais bonjour quand même.");
        return true;
      case "repousser":
        if (await wake.snooze(intent.minutes ?? 9)) reply(`Très bien. Je reviens dans ${intent.minutes ?? 9} minutes.`);
        else reply("Le réveil ne sonne pas.");
        return true;
      case "arreter":
        reply((await wake.dismiss()) ? "Réveil arrêté." : "Le réveil ne sonne pas.");
        return true;
      case "aucun": {
        const date = intent.jour === "aujourdhui" ? wake.today() : wake.tomorrow();
        await wake.setOverride({ date, aucun: true });
        reply(intent.jour === "aujourdhui" ? "Pas de réveil aujourd'hui." : "Pas de réveil demain. Profite.");
        return true;
      }
      case "regler": {
        const date = intent.jour === "aujourdhui" ? wake.today() : wake.tomorrow();
        await wake.setOverride({ date, heure: intent.heure! });
        reply(`Réveil ${intent.jour === "aujourdhui" ? "aujourd'hui" : "demain"} à ${sayTime(intent.heure!)}.`);
        return true;
      }
      case "quand": {
        const next = await wake.refresh();
        reply(next ? `Je te réveille ${next.date === wake.tomorrow() ? "demain" : next.date === wake.today() ? "aujourd'hui" : `le ${new Date(`${next.date}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" })}`} à ${sayTime(next.heure)} : ${next.raison}.` : "Aucun réveil prévu dans les prochains jours.");
        return true;
      }
      case "essai":
        reply("Essai du réveil.");
        await wake.test();
        return true;
    }
  }

  return { runIntent };
}
