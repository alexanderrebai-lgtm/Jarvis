import { runPowerShell } from "./pc.js";
import { sayTime } from "./reveil/schedule.js";
import { runRoutine, type RoutineStep } from "./routines.js";
import type { JarvisServices } from "./main.js";

/**
 * Exécution des routines (« bonne nuit », « je pars », « je suis rentré »…) : chaque étape (lumières, surveillance, disposition, musique, résumé, téléphone…) et le lancement d'une routine.
 */

export type RoutineRunnerDeps = Pick<JarvisServices, "actions" | "agenda" | "applyDisposition" | "pages" | "phone" | "playWakePlaylist" | "reply" | "routines" | "security" | "setFlag" | "setSurveillance" | "spotify" | "spotifyHelpers" | "takeAbsentSince" | "tapo" | "wake">;

export function createRoutineRunner(d: RoutineRunnerDeps) {
  const { actions, agenda, applyDisposition, pages, phone, playWakePlaylist, reply, routines, security, setFlag, setSurveillance, spotify, spotifyHelpers, takeAbsentSince, tapo, wake } = d;
  async function summaryFor(quoi: "demain" | "journee" | "absence"): Promise<string> {
    if (quoi === "demain") {
      const next = wake ? await wake.refresh() : undefined;
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const end = new Date(tomorrow);
      end.setHours(23, 59, 59);
      const events = (await agenda?.list(tomorrow, end).catch(() => [])) ?? [];
      const first = events.find((e) => !e.allDay);
      return [next ? `Réveil ${next.date === wake!.tomorrow() ? "demain" : `le ${next.date}`} à ${sayTime(next.heure)} (${next.raison}).` : "Pas de réveil prévu demain.", first ? `Premier rendez-vous : ${first.summary} à ${new Date(first.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.` : "", "Bonne nuit."].filter(Boolean).join(" ");
    }
    if (quoi === "absence") {
      const since = takeAbsentSince() ?? Date.now() - 12 * 3_600_000;
      const motions = security.events.filter((e) => new Date(e.instant).getTime() > since && e.personne !== false);
      return motions.length ? `Pendant ton absence : ${motions.length} mouvement${motions.length > 1 ? "s" : ""}, le dernier sur la caméra ${motions[0]!.camera} à ${new Date(motions[0]!.instant).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}. Les images sont sur la page Sécurité.` : "Rien à signaler pendant ton absence. Bon retour.";
    }
    return `Aujourd'hui : ${actions.day().filter((a) => a.autorise).length} actions de ma part.`;
  }

  async function runStep(step: RoutineStep): Promise<string | void> {
    switch (step.type) {
      case "lumieres":
        if (!tapo) return;
        await tapo.command(step.cible, { ...(step.action ? { action: step.action } : {}), ...(step.luminosite ? { luminosite: step.luminosite } : {}), ...(step.couleur ? { couleur: step.couleur } : {}) });
        return;
      case "surveillance":
        setSurveillance(step.mode);
        return;
      case "disposition":
        applyDisposition(step.nom, false);
        return;
      case "pages":
        pages.closeAll();
        return;
      case "dire":
        return step.texte;
      case "ne_pas_deranger":
        setFlag("doNotDisturb", step.actif);
        return;
      case "musique":
        if (!spotify.connected) return;
        if (step.action === "pause") await spotify.pause();
        else if (step.action === "reveil") await playWakePlaylist();
        else await spotifyHelpers.play(step.requete);
        return;
      case "resume":
        return summaryFor(step.quoi);
      case "ecrans_veille":
        if (process.platform === "win32") setTimeout(() => void runPowerShell("(Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern int SendMessage(int h,int m,int w,int l);' -Name S -Namespace W -PassThru)::SendMessage(0xFFFF,0x0112,0xF170,2)", 10_000), 8_000);
        return;
      case "telephone":
        if (phone.enabled) await phone.text(`Jarvis : ${step.texte} (${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })})`);
        return;
      case "attendre":
        return;
    }
  }

  async function launchRoutine(name: string): Promise<string> {
    const routine = routines.get(name) ?? routines.match(name);
    if (!routine) return `Je ne connais pas la routine « ${name} ».`;
    let spoke = false;
    const result = await runRoutine(routine, runStep, (text) => {
      spoke = true;
      reply(text);
    });
    actions.add({ outil: "routine", resume: routine.nom, autorise: true });
    return [...result.faits, ...(result.erreurs.length ? [`(Souci : ${result.erreurs.join(" ; ")})`] : [])].join(" ") || (spoke ? "" : "C'est fait.");
  }

  return { launchRoutine };
}
