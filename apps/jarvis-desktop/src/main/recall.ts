import { localParts } from "@muscu/jarvis/src/clock.js";
import type { AgendaService } from "@muscu/jarvis/src/google/agenda.js";
import type { Memoire, Note, NotesRepository } from "@muscu/jarvis/src/notes.js";
import { JsonStore } from "@muscu/jarvis/src/store.js";

/**
 * Rappel vraiment proactif : la couche au-dessus des rappels explicites.
 * Jarvis ressort DE LUI-MÊME la bonne info au bon moment — sans qu'on le lui
 * demande — en reliant ce qu'il sait :
 *  - les « boucles ouvertes » (tu as noté « je dois rappeler le garage » et tu
 *    ne l'as pas fait) ;
 *  - le contexte avant un rendez-vous (ce que tu avais noté sur la personne ou
 *    le sujet refait surface juste avant) ;
 *  - les échos (un fait mémorisé il y a pile un an).
 * Le tout passe par un garde-fou strict (heures calmes, quota par jour, intervalle
 * minimum, anti-répétition) pour ne JAMAIS devenir pénible. C'est ce garde-fou,
 * plus que le reste, qui sépare un assistant utile d'un assistant agaçant.
 */

export type RecallSource = "boucle" | "contexte-rdv" | "echo";

export interface RecallCandidate {
  /** Clé stable pour l'anti-répétition (ne resurgit pas en boucle). */
  cle: string;
  source: RecallSource;
  /** Plus c'est haut, plus c'est prioritaire. */
  score: number;
  /** Phrase prête à dire, déjà en français naturel. */
  texte: string;
}

export interface RecallEmis {
  cle: string;
  source: RecallSource;
  texte: string;
  instant: string;
}

export interface RecallReglage {
  actif: boolean;
  /** Avant cette heure locale, Jarvis se tait (ex. 9). */
  calmeAvant: number;
  /** À partir de cette heure locale, Jarvis se tait (ex. 22). */
  calmeApres: number;
  /** Nombre maximum de rappels proactifs par jour. */
  maxParJour: number;
  /** Intervalle minimum entre deux rappels (minutes). */
  intervalleMinutes: number;
  /** On ne ressort pas la même chose avant ce nombre de jours. */
  repeatJours: number;
  /** On ne ressort jamais la même chose plus de N fois en tout. */
  maxRepetitions: number;
}

export const REGLAGE_DEFAUT: RecallReglage = {
  actif: true,
  calmeAvant: 9,
  calmeApres: 22,
  maxParJour: 4,
  intervalleMinutes: 75,
  repeatJours: 4,
  maxRepetitions: 2,
};

interface RecallState {
  /** cle -> { dernier jour ISO, nombre de fois sortie }. */
  historique: Record<string, { dernier: string; fois: number }>;
  /** jour ISO -> nombre de rappels sortis ce jour-là. */
  parJour: Record<string, number>;
  /** Dernier envoi (ISO complet), pour l'intervalle minimum. */
  dernierEnvoi?: string;
  /** Les derniers rappels sortis (pour l'affichage). */
  recents: RecallEmis[];
}

const STOPWORDS = new Set([
  "avec", "pour", "dans", "chez", "mais", "donc", "faut", "fait", "faire", "alex",
  "rendez", "vous", "rdv", "point", "appel", "appeler", "voir", "matin", "soir",
  "cette", "cette", "mon", "ma", "mes", "ton", "ta", "tes", "une", "des", "les",
  "aux", "sur", "sous", "que", "qui", "quoi", "plus", "moins", "très", "bien",
  "jour", "semaine", "heure", "heures", "demain", "hier", "aujourd", "prochain",
]);

/** Enlève accents, minuscule. */
function normalise(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Mots « porteurs » d'un texte (≥ 4 lettres, hors mots vides) pour le rapprochement. */
export function motsCles(text: string): string[] {
  return [...new Set(normalise(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w)))];
}

/** Une note ressemble-t-elle à une intention non terminée (« je dois… », « penser à… ») ? */
export function estBoucleOuverte(note: Note): boolean {
  if (note.rappelLe) return false; // déjà géré par les rappels explicites
  const t = normalise(note.texte);
  return /\b(je dois|il faut|faut que|faudra|faudrait|penser a|pense a|ne pas oublier|noubli|rappeler|relancer|recontacter|a faire|commander|reserver|prendre rdv|prendre rendez)\b/.test(t);
}

const jourISO = (iso: string): string => iso.slice(0, 10);

/**
 * Boucles ouvertes mûres : notes-intentions ni trop fraîches (on laisse le temps
 * de les faire) ni trop vieilles (ne pas remuer le passé lointain).
 */
export function candidatsBoucles(notes: Note[], now: Date, minHeures = 8, maxJours = 21): RecallCandidate[] {
  const t = now.getTime();
  const out: RecallCandidate[] = [];
  for (const note of notes) {
    if (!estBoucleOuverte(note)) continue;
    const age = t - new Date(note.creeLe).getTime();
    const ageH = age / 3_600_000;
    if (ageH < minHeures || ageH > maxJours * 24) continue;
    const jours = Math.round(ageH / 24);
    const quand = jours <= 0 ? "l'autre jour" : jours === 1 ? "hier" : `il y a ${jours} jours`;
    out.push({
      cle: `boucle:${note.id}`,
      source: "boucle",
      score: 40 + Math.min(ageH / 24, 10),
      texte: `${quand} tu avais noté « ${note.texte} ». Tu as pu t'en occuper, ou tu veux que je t'aide ?`,
    });
  }
  return out;
}

export interface EventLite {
  id: string;
  summary: string;
  start: string;
  allDay?: boolean;
  location?: string;
}

/**
 * Contexte avant un rendez-vous : pour un événement imminent, si une note ou un
 * fait mémorisé parle de la même personne / du même sujet, on le fait resurgir.
 */
export function candidatsContexteRdv(events: EventLite[], notes: Note[], memoires: Memoire[], now: Date, horizonMin = 150): RecallCandidate[] {
  const t = now.getTime();
  const out: RecallCandidate[] = [];
  for (const ev of events) {
    if (ev.allDay) continue;
    const dans = Math.round((new Date(ev.start).getTime() - t) / 60_000);
    if (dans < 0 || dans > horizonMin) continue;
    const cles = motsCles(ev.summary + " " + (ev.location ?? ""));
    if (cles.length === 0) continue;
    const corr = (hay: string) => {
      const h = normalise(hay);
      return cles.some((c) => h.includes(c));
    };
    const noteMatch = notes.find((n) => corr(n.texte + " " + n.tags.join(" ")));
    const memMatch = memoires.find((m) => corr(m.fait));
    const rappel = noteMatch?.texte ?? memMatch?.fait;
    if (!rappel) continue;
    const quand = dans <= 1 ? "dans un instant" : dans < 60 ? `dans ${dans} minutes` : `vers ${new Date(ev.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
    out.push({
      cle: `rdv:${ev.id}`,
      source: "contexte-rdv",
      score: 100 + (horizonMin - dans) / 10,
      texte: `Avant « ${ev.summary} » ${quand}, souviens-toi : ${rappel}`,
    });
  }
  return out;
}

/** Échos : un fait mémorisé il y a pile un an (± quelques jours). */
export function candidatsEchos(memoires: Memoire[], now: Date): RecallCandidate[] {
  const out: RecallCandidate[] = [];
  for (const m of memoires) {
    const d = new Date(m.creeLe);
    const ans = (now.getTime() - d.getTime()) / (365.25 * 86_400_000);
    const entier = Math.round(ans);
    if (entier < 1) continue;
    if (Math.abs(ans - entier) * 365.25 > 2) continue; // à ± 2 jours de l'anniversaire
    out.push({
      cle: `echo:${m.id}:${entier}`,
      source: "echo",
      score: 20,
      texte: `Il y a ${entier} an${entier > 1 ? "s" : ""} jour pour jour, tu notais : « ${m.fait} ».`,
    });
  }
  return out;
}

/**
 * Le garde-fou. Décide quel candidat (s'il y en a un) sortir maintenant, ou
 * pourquoi on se tait. Fonction pure : tout le comportement anti-harcèlement est
 * testable sans brancher le micro.
 */
export function choisir(
  candidats: RecallCandidate[],
  state: RecallState,
  reglage: RecallReglage,
  now: Date,
  timeZone: string,
): { emis?: RecallCandidate; silence?: string } {
  if (!reglage.actif) return { silence: "désactivé" };
  const local = localParts(now, timeZone);
  if (local.hour < reglage.calmeAvant || local.hour >= reglage.calmeApres) return { silence: "heures calmes" };
  if ((state.parJour[local.day] ?? 0) >= reglage.maxParJour) return { silence: "quota du jour atteint" };
  if (state.dernierEnvoi && now.getTime() - new Date(state.dernierEnvoi).getTime() < reglage.intervalleMinutes * 60_000)
    return { silence: "trop tôt après le dernier" };
  const eligibles = candidats
    .filter((c) => {
      const h = state.historique[c.cle];
      if (!h) return true;
      if (h.fois >= reglage.maxRepetitions) return false;
      const jours = (now.getTime() - new Date(h.dernier).getTime()) / 86_400_000;
      return jours >= reglage.repeatJours;
    })
    .sort((a, b) => b.score - a.score);
  if (eligibles.length === 0) return { silence: "rien de nouveau à dire" };
  return { emis: eligibles[0] };
}

export interface RecallDeps {
  dataDir: string;
  timeZone: string;
  notes: NotesRepository;
  agenda: AgendaService | undefined;
  reglage: RecallReglage;
  /** Dit une phrase à voix haute et l'affiche. */
  say: (text: string) => void;
  notify: (title: string, body: string) => void;
  /** Faux quand Alex a mis « ne pas déranger » ou qu'un jeu tourne. */
  canSpeak: () => boolean;
  now?: () => Date;
}

export class RecallEngine {
  private readonly store: JsonStore<RecallState>;
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(private readonly deps: RecallDeps) {
    this.store = new JsonStore(deps.dataDir, "rappels-proactifs", () => ({ historique: {}, parJour: {}, recents: [] }));
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  start(): void {
    if (!this.deps.reglage.actif) return;
    const run = () => {
      if (this.busy) return;
      this.busy = true;
      void this.tick()
        .catch((e) => console.error("[rappel-proactif]", e))
        .finally(() => (this.busy = false));
    };
    setTimeout(run, 45_000); // on laisse Jarvis démarrer tranquillement
    this.timer = setInterval(run, 5 * 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  recents(limit = 10): RecallEmis[] {
    return this.store.read().recents.slice(-limit).reverse();
  }

  /** Construit les candidats depuis tout ce que Jarvis sait maintenant. */
  private async candidats(now: Date): Promise<RecallCandidate[]> {
    const notes = this.deps.notes.list(200);
    const memoires = this.deps.notes.memories();
    let events: EventLite[] = [];
    if (this.deps.agenda) {
      try {
        events = (await this.deps.agenda.list(now, new Date(now.getTime() + 150 * 60_000))) as EventLite[];
      } catch {
        events = [];
      }
    }
    return [
      ...candidatsContexteRdv(events, notes, memoires, now),
      ...candidatsBoucles(notes, now),
      ...candidatsEchos(memoires, now),
    ];
  }

  async tick(): Promise<RecallCandidate | undefined> {
    if (!this.deps.canSpeak()) return undefined;
    const now = this.now();
    const candidats = await this.candidats(now);
    const { emis } = choisir(candidats, this.store.read(), this.deps.reglage, now, this.deps.timeZone);
    if (!emis) return undefined;
    this.emettre(emis, now);
    return emis;
  }

  private emettre(c: RecallCandidate, now: Date): void {
    const day = localParts(now, this.deps.timeZone).day;
    this.store.update((s) => {
      const h = s.historique[c.cle];
      return {
        historique: { ...s.historique, [c.cle]: { dernier: now.toISOString(), fois: (h?.fois ?? 0) + 1 } },
        parJour: { ...s.parJour, [day]: (s.parJour[day] ?? 0) + 1 },
        dernierEnvoi: now.toISOString(),
        recents: [...s.recents, { cle: c.cle, source: c.source, texte: c.texte, instant: now.toISOString() }].slice(-50),
      };
    });
    this.deps.notify("Jarvis y pense", c.texte);
    this.deps.say(c.texte);
  }
}
