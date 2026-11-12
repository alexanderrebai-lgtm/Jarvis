import type { AgendaService } from "./google/agenda.js";
import type { MailService } from "./google/mail.js";
import type { PendingActions } from "./pending.js";

/** Exécute une action après le feu vert de l'utilisateur. Renvoie un message de compte rendu. */
export async function executePending(
  id: string,
  pending: PendingActions,
  services: { mail: MailService | undefined; agenda: AgendaService | undefined },
): Promise<string> {
  const entry = pending.claim(id);
  if (!entry) return "Cette action a déjà été traitée ou a expiré.";
  const { action } = entry;
  try {
    switch (action.kind) {
      case "send_email": {
        if (!services.mail) throw new Error("Gmail n'est pas connecté.");
        await services.mail.send({
          to: action.to,
          subject: action.subject,
          body: action.body,
          ...(action.cc ? { cc: action.cc } : {}),
          ...(action.threadId ? { threadId: action.threadId } : {}),
          ...(action.inReplyTo ? { inReplyTo: action.inReplyTo } : {}),
          ...(action.references ? { references: action.references } : {}),
        });
        return `✅ Mail envoyé à ${action.to}.`;
      }
      case "delete_event": {
        if (!services.agenda) throw new Error("Google Agenda n'est pas connecté.");
        await services.agenda.remove(action.eventId);
        return `✅ Rendez-vous supprimé : ${action.summary}.`;
      }
    }
  } catch (error) {
    pending.setStatus(id, "failed");
    return `❌ Échec : ${error instanceof Error ? error.message : String(error)}`;
  }
}
