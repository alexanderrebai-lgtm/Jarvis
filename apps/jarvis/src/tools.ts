import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { analyseEsperance, auMoinsUn, faisabilite, matriceDecision } from "./decision.js";
import type { WebBrowser } from "./browser.js";
import type { AgendaService } from "./google/agenda.js";
import type { HomeAssistant } from "./home.js";
import type { Inbox } from "./inbox.js";
import type { TapoHome } from "./tapo.js";
import type { MailService } from "./google/mail.js";
import { emailAddress } from "./mime.js";
import type { NotesRepository } from "./notes.js";
import type { PendingActions, PendingEntry } from "./pending.js";

export interface ToolContext {
  mail: MailService | undefined;
  agenda: AgendaService | undefined;
  notes: NotesRepository;
  pending: PendingActions;
  inbox: Inbox;
  browser: WebBrowser | undefined;
  home?: HomeAssistant | undefined;
  tapo?: TapoHome | undefined;
}

/** Résultat d'outil contenant une image (capture d'écran du navigateur). */
export interface ToolImage {
  kind: "image";
  data: string;
  mediaType: "image/jpeg";
  caption: string;
}

export function isToolImage(value: unknown): value is ToolImage {
  return typeof value === "object" && value !== null && (value as ToolImage).kind === "image";
}

export interface LocalTool<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>, ctx: ToolContext, created: PendingEntry[]) => Promise<unknown>;
}

export function tool<S extends z.ZodType>(definition: LocalTool<S>): LocalTool<S> {
  return definition;
}

function requireMail(ctx: ToolContext): MailService {
  if (!ctx.mail) throw new Error("Gmail n'est pas connecté (variables GOOGLE_* manquantes).");
  return ctx.mail;
}

function requireAgenda(ctx: ToolContext): AgendaService {
  if (!ctx.agenda) throw new Error("Google Agenda n'est pas connecté (variables GOOGLE_* manquantes).");
  return ctx.agenda;
}

const isoDate = z.string().describe("Date et heure ISO 8601 avec fuseau, ex. 2026-11-12T14:30:00+01:00");

const mailDraft = z.object({
  a: z.string().describe("Destinataire(s), séparés par des virgules. Chaîne vide pour répondre à l'expéditeur de repondre_a_id."),
  objet: z.string().describe("Objet ; chaîne vide pour une réponse (« Re: » + objet d'origine)."),
  corps: z.string().describe("Texte du mail, signé au nom de l'utilisateur."),
  cc: z.string().optional(),
  repondre_a_id: z.string().optional().describe("Identifiant du mail auquel on répond, pour rester dans le même fil."),
});

async function resolveMail(input: z.infer<typeof mailDraft>, ctx: ToolContext) {
  const mail = requireMail(ctx);
  if (!input.repondre_a_id) {
    return { to: input.a, subject: input.objet, body: input.corps, ...(input.cc ? { cc: input.cc } : {}) };
  }
  const original = await mail.read(input.repondre_a_id);
  const subject = input.objet || (/^re\s*:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`);
  return {
    to: input.a || emailAddress(original.from),
    subject,
    body: input.corps,
    ...(input.cc ? { cc: input.cc } : {}),
    threadId: original.threadId,
    inReplyTo: original.messageId,
    references: [original.references, original.messageId].filter(Boolean).join(" "),
  };
}

function requireBrowser(ctx: ToolContext): WebBrowser {
  if (!ctx.browser) throw new Error("Le navigateur est désactivé sur ce serveur (BROWSER_ENABLED=false).");
  return ctx.browser;
}

const BROWSER_TOOLS = [
  tool({
    name: "navigateur_ouvrir",
    description:
      "Ouvre une page web dans le navigateur de l'assistant (réserver un restaurant, un rendez-vous, un billet, remplir un formulaire, comparer des offres). Renvoie le texte de la page et la liste numérotée des éléments cliquables ou remplissables.",
    schema: z.object({ url: z.string().describe("Adresse complète, https://…") }),
    run: (input, ctx) => requireBrowser(ctx).open(input.url),
  }),
  tool({
    name: "navigateur_lire",
    description: "Relit la page actuellement ouverte (texte et éléments numérotés).",
    schema: z.object({}),
    run: (_input, ctx) => requireBrowser(ctx).read(),
  }),
  tool({
    name: "navigateur_cliquer",
    description:
      "Clique sur un élément par son numéro. Pour un bouton qui engage (réserver, payer, commander, confirmer, envoyer), résume d'abord à l'utilisateur ce qui va se passer et attends son accord explicite, puis mets confirmation_utilisateur à true.",
    schema: z.object({
      numero: z.number().int().min(1),
      confirmation_utilisateur: z.boolean().optional().describe("true seulement si l'utilisateur vient d'approuver cette action précise."),
    }),
    run: (input, ctx) => requireBrowser(ctx).click(input.numero, input.confirmation_utilisateur === true),
  }),
  tool({
    name: "navigateur_remplir",
    description:
      "Remplit un champ (ou choisit dans une liste) par son numéro : nom, date, nombre de personnes, recherche… Jamais de données bancaires.",
    schema: z.object({ numero: z.number().int().min(1), texte: z.string() }),
    run: (input, ctx) => requireBrowser(ctx).fill(input.numero, input.texte),
  }),
  tool({
    name: "navigateur_touche",
    description: "Appuie sur une touche du clavier dans la page (Enter, Escape, Tab, ArrowDown…).",
    schema: z.object({ touche: z.string() }),
    run: (input, ctx) => requireBrowser(ctx).press(input.touche),
  }),
  tool({
    name: "navigateur_capture",
    description: "Capture d'écran de la page, pour voir une mise en page compliquée, un plan de salle ou un calendrier de disponibilités.",
    schema: z.object({}),
    run: async (_input, ctx): Promise<ToolImage> => ({
      kind: "image",
      data: await requireBrowser(ctx).screenshot(),
      mediaType: "image/jpeg",
      caption: "Capture de la page actuelle",
    }),
  }),
];

function requireHome(ctx: ToolContext): HomeAssistant {
  if (!ctx.home) throw new Error("La maison n'est pas connectée (HOME_ASSISTANT_URL et HOME_ASSISTANT_TOKEN manquants).");
  return ctx.home;
}

const HOME_TOOLS = [
  tool({
    name: "maison_etat",
    description:
      "État des objets connectés de la maison (lumières, prises, chauffage, volets, enceintes, aspirateur, capteurs de température, portes…). Filtre par mot-clé (« salon », « chambre », « température ») ou par type Home Assistant (light, switch, climate, cover, media_player, vacuum, sensor…).",
    schema: z.object({ recherche: z.string().optional(), type: z.string().optional() }),
    run: (input, ctx) => requireHome(ctx).states(input.recherche, input.type),
  }),
  tool({
    name: "maison_commande",
    description:
      "Pilote un objet connecté via Home Assistant. Lis d'abord maison_etat pour avoir l'identifiant exact. Exemples d'actions : light.turn_on (parametres brightness_pct, color_name, color_temp_kelvin), turn_off, toggle ; climate.set_temperature (temperature) ; cover.open_cover, close_cover, set_cover_position (position) ; media_player.media_play, media_pause, volume_set (volume_level 0 à 1) ; vacuum.start, return_to_base ; scene.turn_on. Serrures, alarme, portail et garage : accord explicite de l'utilisateur obligatoire (confirmation_utilisateur=true).",
    schema: z.object({
      entite: z.string().describe("Identifiant Home Assistant, ex. light.salon"),
      action: z.string().describe("Nom de l'action sans le type, ex. turn_on, set_temperature"),
      parametres: z.record(z.string(), z.unknown()).optional(),
      confirmation_utilisateur: z.boolean().optional(),
    }),
    run: (input, ctx) =>
      requireHome(ctx).command(input.entite, input.action, input.parametres ?? {}, input.confirmation_utilisateur === true),
  }),
];

function requireTapo(ctx: ToolContext): TapoHome {
  if (!ctx.tapo) throw new Error("Les appareils Tapo ne sont pas connectés (TAPO_EMAIL et TAPO_PASSWORD manquants).");
  return ctx.tapo;
}

const TAPO_TOOLS = [
  tool({
    name: "tapo_etat",
    description:
      "Liste les ampoules et prises Tapo de la maison avec leur état (allumé, luminosité). avec_consommation=true ajoute la consommation des prises qui la mesurent (P110, P115).",
    schema: z.object({ avec_consommation: z.boolean().optional() }),
    run: (input, ctx) => requireTapo(ctx).states(input.avec_consommation === true),
  }),
  tool({
    name: "tapo_commande",
    description:
      "Allume, éteint ou règle des ampoules et prises Tapo. cible : nom d'un appareil (« salon », « lampe chambre ») ou groupe (« tout », « toutes les lumières », « toutes les prises »). luminosite de 1 à 100. couleur : warmwhite, daylightwhite, white, red, blue, green, yellow, un code #RRGGBB ou une température comme 2700k. Régler la luminosité ou la couleur allume l'ampoule.",
    schema: z.object({
      cible: z.string(),
      action: z.enum(["allumer", "eteindre"]).optional(),
      luminosite: z.number().min(1).max(100).optional(),
      couleur: z.string().optional(),
    }),
    run: (input, ctx) =>
      requireTapo(ctx).command(input.cible, {
        ...(input.action ? { action: input.action } : {}),
        ...(input.luminosite !== undefined ? { luminosite: input.luminosite } : {}),
        ...(input.couleur ? { couleur: input.couleur } : {}),
      }),
  }),
];

export const LOCAL_TOOLS = [
  ...TAPO_TOOLS,
  ...HOME_TOOLS,
  tool({
    name: "messages_recus",
    description:
      "Lit les SMS et messages reçus sur le téléphone de l'utilisateur et transmis par ses raccourcis iPhone (ou partagés depuis WhatsApp, Instagram…).",
    schema: z.object({
      depuis_heures: z.number().min(1).max(24 * 30).optional().describe("Fenêtre en heures (24 par défaut)."),
      de: z.string().optional().describe("Filtre sur l'expéditeur."),
    }),
    run: async (input, ctx) => ctx.inbox.recent(input.depuis_heures ?? 24, input.de),
  }),
  ...BROWSER_TOOLS,
  tool({
    name: "mails_rechercher",
    description:
      "Cherche des mails Gmail avec la syntaxe de recherche Gmail (ex. « is:unread newer_than:1d », « from:sncf », « subject:facture »). Renvoie expéditeur, objet, date et extrait.",
    schema: z.object({ requete: z.string(), max: z.number().int().min(1).max(25).optional() }),
    run: (input, ctx) => requireMail(ctx).search(input.requete, input.max ?? 10),
  }),
  tool({
    name: "mail_lire",
    description: "Lit le contenu complet d'un mail à partir de son identifiant.",
    schema: z.object({ id: z.string() }),
    run: (input, ctx) => requireMail(ctx).read(input.id),
  }),
  tool({
    name: "mail_preparer_envoi",
    description:
      "Prépare l'envoi d'un mail ou d'une réponse. Le mail N'EST PAS envoyé : il attend la confirmation de l'utilisateur. Utilise-le quand on te demande d'envoyer ou de répondre, puis montre le récapitulatif.",
    schema: mailDraft,
    run: async (input, ctx, created) => {
      const mail = await resolveMail(input, ctx);
      const entry = ctx.pending.create({ kind: "send_email", ...mail });
      created.push(entry);
      return { statut: "en attente de confirmation par l'utilisateur", action: entry.id, a: mail.to, objet: mail.subject };
    },
  }),
  tool({
    name: "mail_creer_brouillon",
    description: "Enregistre un brouillon dans Gmail sans l'envoyer (l'utilisateur le retrouvera dans ses brouillons).",
    schema: mailDraft,
    run: async (input, ctx) => {
      const mail = await resolveMail(input, ctx);
      return { brouillon: await requireMail(ctx).createDraft(mail) };
    },
  }),
  tool({
    name: "mail_ranger",
    description: "Marque un mail comme lu, l'archive ou le met en favori.",
    schema: z.object({
      id: z.string(),
      marquer_lu: z.boolean().optional(),
      archiver: z.boolean().optional(),
      favori: z.boolean().optional(),
    }),
    run: async (input, ctx) => {
      await requireMail(ctx).modifyLabels(input.id, {
        ...(input.marquer_lu !== undefined ? { markRead: input.marquer_lu } : {}),
        ...(input.archiver !== undefined ? { archive: input.archiver } : {}),
        ...(input.favori !== undefined ? { star: input.favori } : {}),
      });
      return { ok: true };
    },
  }),
  tool({
    name: "agenda_lister",
    description: "Liste les rendez-vous de Google Agenda entre deux dates, avec une recherche texte facultative.",
    schema: z.object({ debut: isoDate, fin: isoDate, recherche: z.string().optional() }),
    run: (input, ctx) => requireAgenda(ctx).list(new Date(input.debut), new Date(input.fin), input.recherche),
  }),
  tool({
    name: "agenda_creneaux_libres",
    description: "Trouve les créneaux libres entre deux dates (par ex. une journée de 9 h à 19 h) d'une durée minimale.",
    schema: z.object({ debut: isoDate, fin: isoDate, duree_minutes: z.number().int().min(5).optional() }),
    run: (input, ctx) => requireAgenda(ctx).freeSlots(new Date(input.debut), new Date(input.fin), input.duree_minutes ?? 30),
  }),
  tool({
    name: "agenda_creer",
    description:
      "Crée un rendez-vous. Vérifie d'abord les conflits avec agenda_lister. Les invités ne sont pas notifiés automatiquement.",
    schema: z.object({
      titre: z.string(),
      debut: isoDate,
      fin: isoDate,
      lieu: z.string().optional(),
      description: z.string().optional(),
      invites: z.array(z.string()).optional(),
      journee_entiere: z.boolean().optional(),
    }),
    run: (input, ctx) =>
      requireAgenda(ctx).create({
        titre: input.titre,
        debut: input.debut,
        fin: input.fin,
        ...(input.lieu ? { lieu: input.lieu } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.invites ? { invites: input.invites } : {}),
        ...(input.journee_entiere ? { journeeEntiere: true } : {}),
      }),
  }),
  tool({
    name: "agenda_modifier",
    description: "Déplace ou modifie un rendez-vous existant (seuls les champs donnés changent).",
    schema: z.object({
      id: z.string(),
      titre: z.string().optional(),
      debut: isoDate.optional(),
      fin: isoDate.optional(),
      lieu: z.string().optional(),
      description: z.string().optional(),
    }),
    run: (input, ctx) => {
      const { id, ...rest } = input;
      return requireAgenda(ctx).update(id, rest);
    },
  }),
  tool({
    name: "agenda_preparer_suppression",
    description: "Prépare la suppression d'un rendez-vous. Rien n'est supprimé avant la confirmation de l'utilisateur.",
    schema: z.object({ id: z.string() }),
    run: async (input, ctx, created) => {
      const event = await requireAgenda(ctx).get(input.id);
      const entry = ctx.pending.create({ kind: "delete_event", eventId: event.id, summary: `${event.summary} (${event.start})` });
      created.push(entry);
      return { statut: "en attente de confirmation par l'utilisateur", action: entry.id };
    },
  }),
  tool({
    name: "note_ajouter",
    description:
      "Enregistre une note (idée, liste, info à retenir). Avec rappel_le, l'utilisateur reçoit un rappel à cette date.",
    schema: z.object({ texte: z.string(), tags: z.array(z.string()).optional(), rappel_le: isoDate.optional() }),
    run: async (input, ctx) => ctx.notes.add(input.texte, input.tags ?? [], input.rappel_le),
  }),
  tool({
    name: "notes_chercher",
    description: "Cherche dans les notes (sans requête : les plus récentes).",
    schema: z.object({ requete: z.string().optional() }),
    run: async (input, ctx) => (input.requete ? ctx.notes.search(input.requete) : ctx.notes.list()),
  }),
  tool({
    name: "note_supprimer",
    description: "Supprime une note par son identifiant.",
    schema: z.object({ id: z.string() }),
    run: async (input, ctx) => ({ supprimee: ctx.notes.remove(input.id) }),
  }),
  tool({
    name: "memoire_ajouter",
    description:
      "Mémorise durablement un fait utile sur l'utilisateur (préférences, proches, habitudes, objectifs). À utiliser quand il te dit quelque chose qui servira plus tard.",
    schema: z.object({ fait: z.string() }),
    run: async (input, ctx) => ctx.notes.remember(input.fait),
  }),
  tool({
    name: "memoire_consulter",
    description: "Relit tous les faits mémorisés sur l'utilisateur.",
    schema: z.object({}),
    run: async (_input, ctx) => ctx.notes.memories(),
  }),
  tool({
    name: "memoire_oublier",
    description: "Oublie un fait mémorisé (par son identifiant).",
    schema: z.object({ id: z.string() }),
    run: async (input, ctx) => ({ oublie: ctx.notes.forget(input.id) }),
  }),
  tool({
    name: "decision_esperance",
    description:
      "Compare des options à issue incertaine : pour chaque option, des scénarios avec une probabilité (0 à 1) et une valeur (gain positif, perte négative, dans la même unité). Renvoie espérance, écart type (risque), pire et meilleur cas, probabilité de perte.",
    schema: z.object({
      options: z.array(
        z.object({
          nom: z.string(),
          scenarios: z.array(z.object({ description: z.string(), probabilite: z.number(), valeur: z.number() })),
        }),
      ),
    }),
    run: async (input) => analyseEsperance(input.options),
  }),
  tool({
    name: "decision_matrice",
    description:
      "Matrice de décision pondérée : des critères avec un poids, et pour chaque option une note de 0 à 10 par critère. Renvoie un score sur 10 et le classement.",
    schema: z.object({
      criteres: z.array(z.object({ nom: z.string(), poids: z.number() })),
      options: z.array(z.object({ nom: z.string(), notes: z.record(z.string(), z.number()) })),
    }),
    run: async (input) => matriceDecision(input.criteres, input.options),
  }),
  tool({
    name: "decision_faisabilite",
    description:
      "Probabilité de réussite d'un projet dont toutes les étapes doivent réussir. Pour chaque étape, une fourchette de probabilité (min et max, de 0 à 1). Simulation de Monte-Carlo : probabilité centrale, percentiles 10/50/90 et étape critique.",
    schema: z.object({
      etapes: z.array(z.object({ nom: z.string(), min: z.number(), max: z.number() })),
    }),
    run: async (input) => faisabilite(input.etapes),
  }),
  tool({
    name: "probabilite_au_moins_un",
    description: "Probabilité qu'au moins un événement indépendant se produise (ex. décrocher au moins un entretien sur 8 candidatures).",
    schema: z.object({ probabilites: z.array(z.number()) }),
    run: async (input) => ({ probabilite: auMoinsUn(input.probabilites) }),
  }),
];

function inputSchema(schema: z.ZodType): Anthropic.Beta.BetaTool.InputSchema {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json as Anthropic.Beta.BetaTool.InputSchema;
}

/** Définitions envoyées à Claude, dans un ordre fixe (le cache de prompt en dépend). */
export function toolDefinitions(): Anthropic.Beta.BetaToolUnion[] {
  return [
    ...LOCAL_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: inputSchema(t.schema) })),
    { type: "web_search_20260209", name: "web_search", max_uses: 6 },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4 },
  ];
}

export type ToolOutcome = { content: string; isError: boolean; image?: ToolImage };

export async function runTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
  created: PendingEntry[],
  tools: ReadonlyArray<LocalTool<z.ZodType>> = LOCAL_TOOLS,
): Promise<ToolOutcome> {
  const definition = tools.find((t) => t.name === name);
  if (!definition) return { content: `Outil inconnu : ${name}`, isError: true };
  const parsed = definition.schema.safeParse(rawInput);
  if (!parsed.success) return { content: `Paramètres invalides : ${parsed.error.message}`, isError: true };
  try {
    // Le type exact dépend de l'outil ; la validation zod ci-dessus le garantit.
    const result = await (definition.run as (i: unknown, c: ToolContext, p: PendingEntry[]) => Promise<unknown>)(
      parsed.data,
      ctx,
      created,
    );
    if (isToolImage(result)) return { content: result.caption, isError: false, image: result };
    return { content: JSON.stringify(result ?? { ok: true }), isError: false };
  } catch (error) {
    return { content: `Erreur : ${error instanceof Error ? error.message : String(error)}`, isError: true };
  }
}
