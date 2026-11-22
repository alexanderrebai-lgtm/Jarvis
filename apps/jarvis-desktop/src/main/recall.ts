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

export type Avis = "utile" | "inutile";

export interface RecallEmis {
  cle: string;
  source: RecallSource;
  texte: string;
  instant: string;
  /** Ce qu'Alex en a pensé (boutons 👍 / 👎). */
  avis?: Avis;
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
  /** Avis d'Alex par rappel : « inutile » = on ne le ressort plus jamais. */
  retours?: Record<string, Avis>;
  /** Votes cumulés par source (« source:boucle ») et par heure (« heure:14 »), pour apprendre quoi dire et quand. */
  stats?: Record<string, { utile: number; inutile: number }>;
}

type Stat = { utile: number; inutile: number } | undefined;
const votes = (s: Stat): number => (s?.utile ?? 0) + (s?.inutile ?? 0);
/** Taux de satisfaction lissé (0 à 1) : sans vote, 0,5. */
const taux = (s: Stat): number => ((s?.utile ?? 0) + 1) / (votes(s) + 2);

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

/** Racine approximative d'un mot (5 premières lettres) : « courroie » ≈ « courroies », « rappeler » ≈ « rappel ». */
export function racines(text: string): Set<string> {
  return new Set(motsCles(text).map((w) => w.slice(0, 5)));
}

/** Nombre de racines communes entre deux textes. */
export function racinesCommunes(a: string, b: string): number {
  const rb = racines(b);
  let n = 0;
  for (const r of racines(a)) if (rb.has(r)) n++;
  return n;
}

const FAIT = /\b(j ai|c est fait|fait|termine|reglee?|regle|appele|rappele|envoye|commande|reserve|pris|achete|ok pour|deja)\b/;

/** Une intention notée plus tôt a-t-elle l'air d'avoir été réalisée depuis (note ou souvenir plus récent qui en parle au passé) ? */
export function estResolue(boucle: Note, autres: Array<{ texte: string; creeLe: string }>): boolean {
  const t0 = new Date(boucle.creeLe).getTime();
  return autres.some((o) => new Date(o.creeLe).getTime() > t0 && FAIT.test(normalise(o.texte).replace(/[^a-z0-9]+/g, " ")) && racinesCommunes(boucle.texte, o.texte) >= 2);
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
export function candidatsBoucles(notes: Note[], now: Date, minHeures = 8, maxJours = 21, memoires: Memoire[] = []): RecallCandidate[] {
  const t = now.getTime();
  const out: RecallCandidate[] = [];
  const autres = [...notes.map((n) => ({ texte: n.texte, creeLe: n.creeLe })), ...memoires.map((m) => ({ texte: m.fait, creeLe: m.creeLe }))];
  for (const note of notes) {
    if (!estBoucleOuverte(note)) continue;
    if (estResolue(note, autres.filter((o) => o.texte !== note.texte))) continue; // déjà fait depuis : on n'embête pas
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
export function candidatsContexteRdv(
  events: EventLite[],
  notes: Note[],
  memoires: Memoire[],
  now: Date,
  horizonMin = 150,
  /** Rapprochements trouvés par le sens (identifiant du rendez-vous → texte rappelé), quand le modèle local est là. */
  sens: Record<string, string> = {},
): RecallCandidate[] {
  const t = now.getTime();
  const out: RecallCandidate[] = [];
  for (const ev of events) {
    if (ev.allDay) continue;
    const dans = Math.round((new Date(ev.start).getTime() - t) / 60_000);
    if (dans < 0 || dans > horizonMin) continue;
    const cle = ev.summary + " " + (ev.location ?? "");
    if (motsCles(cle).length === 0) continue;
    const corr = (hay: string) => racinesCommunes(cle, hay) >= 1;
    const noteMatch = notes.find((n) => corr(n.texte + " " + n.tags.join(" ")));
    const memMatch = memoires.find((m) => corr(m.fait));
    const rappel = noteMatch?.texte ?? memMatch?.fait ?? sens[ev.id];
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
  // Ce qu'Alex a appris à Jarvis : une heure qui l'agace, une catégorie qu'il juge inutile, un rappel refusé.
  const heureStat = state.stats?.[`heure:${local.hour}`];
  if (votes(heureStat) >= 3 && taux(heureStat) < 0.3) return { silence: "heure peu appréciée" };
  const eligibles = candidats
    .map((c) => ({ ...c, score: c.score * (0.6 + taux(state.stats?.[`source:${c.source}`])) }))
    .filter((c) => {
      if (state.retours?.[c.cle] === "inutile") return false;
      const st = state.stats?.[`source:${c.source}`];
      if (votes(st) >= 5 && taux(st) < 0.25) return false;
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
  /** Modèle de sens local (le même que la bibliothèque) : retrouve « courroie de distribution » dans « kit de distribution ». Facultatif. */
  embedder?: { embed: (texts: string[], kind: "query" | "passage") => Promise<Float32Array[]> } | undefined;
  now?: () => Date;
}

const dot = (a: Float32Array, b: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};

export class RecallEngine {
  private readonly store: JsonStore<RecallState>;
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(private readonly deps: RecallDeps) {
    this.store = new JsonStore(deps.dataDir, "rappels-proactifs", () => ({ historique: {}, parJour: {}, recents: [], retours: {}, stats: {} }));
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
    const sens = await this.rapprochementsParSens(events, notes, memoires, now);
    return [
      ...candidatsContexteRdv(events, notes, memoires, now, 150, sens),
      ...candidatsBoucles(notes, now, 8, 21, memoires),
      ...candidatsEchos(memoires, now),
    ];
  }

  private vecteurs = new Map<string, Float32Array>();

  /**
   * Pour les rendez-vous imminents sans correspondance de mots, cherche par le sens la note ou le souvenir
   * le plus proche. Silencieux et facultatif : sans modèle local, on garde les mots-clés.
   */
  private async rapprochementsParSens(events: EventLite[], notes: Note[], memoires: Memoire[], now: Date): Promise<Record<string, string>> {
    const e = this.deps.embedder;
    const proches = events.filter((ev) => !ev.allDay && new Date(ev.start).getTime() - now.getTime() <= 150 * 60_000 && new Date(ev.start).getTime() >= now.getTime());
    if (!e || proches.length === 0) return {};
    try {
      const corpus = [...notes.map((n) => ({ id: n.id, texte: n.texte })), ...memoires.map((m) => ({ id: m.id, texte: m.fait }))].slice(0, 300);
      const manquants = corpus.filter((c) => !this.vecteurs.has(c.id + c.texte));
      for (let i = 0; i < manquants.length; i += 16) {
        const lot = manquants.slice(i, i + 16);
        const vs = await e.embed(lot.map((c) => c.texte), "passage");
        lot.forEach((c, k) => this.vecteurs.set(c.id + c.texte, vs[k]!));
      }
      const out: Record<string, string> = {};
      for (const ev of proches) {
        const [q] = await e.embed([ev.summary + (ev.location ? ` ${ev.location}` : "")], "query");
        let meilleur: { texte: string; score: number } | undefined;
        for (const c of corpus) {
          const v = this.vecteurs.get(c.id + c.texte);
          if (!v || !q) continue;
          const score = dot(q, v);
          if (!meilleur || score > meilleur.score) meilleur = { texte: c.texte, score };
        }
        if (meilleur && meilleur.score >= 0.84) out[ev.id] = meilleur.texte; // seuil prudent : mieux vaut se taire que dire une bêtise
      }
      return out;
    } catch {
      return {};
    }
  }

  /** Alex juge un rappel (👍 / 👎) : ça règle ce que Jarvis ressort et à quelle heure. */
  retour(cle: string, avis: Avis): boolean {
    const state = this.store.read();
    const entree = [...state.recents].reverse().find((r) => r.cle === cle);
    if (!entree) return false;
    const heure = localParts(new Date(entree.instant), this.deps.timeZone).hour;
    this.store.update((s) => {
      const stats = { ...(s.stats ?? {}) };
      const bump = (k: string) => {
        const cur = stats[k] ?? { utile: 0, inutile: 0 };
        const prev = s.retours?.[cle];
        // Si Alex change d'avis, on retire l'ancien vote avant d'ajouter le nouveau.
        stats[k] = { utile: cur.utile - (prev === "utile" ? 1 : 0) + (avis === "utile" ? 1 : 0), inutile: cur.inutile - (prev === "inutile" ? 1 : 0) + (avis === "inutile" ? 1 : 0) };
      };
      bump(`source:${entree.source}`);
      bump(`heure:${heure}`);
      return { ...s, retours: { ...(s.retours ?? {}), [cle]: avis }, stats, recents: s.recents.map((r) => (r.cle === cle ? { ...r, avis } : r)) };
    });
    return true;
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
