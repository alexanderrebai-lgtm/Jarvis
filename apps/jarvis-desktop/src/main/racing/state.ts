/** État de course commun aux jeux (F1, Le Mans Ultimate), tel que l'ingénieur le lit. */

export type Game = "F1" | "LMU";
export type Flag = "vert" | "jaune" | "bleu" | "rouge" | "safety_car" | "vsc" | "damier";

export interface LapRecord {
  numero: number;
  tempsS: number;
  valide: boolean;
  position?: number;
  carburant?: number;
  energie?: number;
}

export interface RaceState {
  jeu: Game;
  actif: boolean;
  miseAJour: number;
  piste?: string;
  session?: string;
  /** Vrai en course (pas en essais ni en qualification). */
  enCourse?: boolean;
  totalTours?: number;
  tempsRestantS?: number;
  tour?: number;
  position?: number;
  nbVoitures?: number;
  classe?: string;
  dernierTourS?: number;
  meilleurTourS?: number;
  tourActuelS?: number;
  secteur?: number;
  tourInvalide?: boolean;
  ecartDevantS?: number;
  ecartDerriereS?: number;
  ecartLeaderS?: number;
  pilotes?: { devant?: string; derriere?: string };
  carburant?: { restant?: number; capacite?: number; unite: "kg" | "L"; parTour?: number; toursRestants?: number; margeTours?: number };
  energie?: { fraction: number; parTour?: number; toursRestants?: number };
  pneus?: { compose?: string; age?: number; surface?: number[]; coeur?: number[]; usure?: number[]; pression?: number[] };
  freins?: { temperature?: number[] };
  degats?: Record<string, number>;
  drapeau?: Flag;
  penalitesS?: number;
  avertissements?: number;
  stand?: { arrets?: number; dansLaVoie?: boolean; tourIdeal?: number; tourMax?: number };
  meteo?: { pluieProchainePct?: number; pisteC?: number; airC?: number };
  tours: LapRecord[];
}

export function emptyState(jeu: Game): RaceState {
  return { jeu, actif: false, miseAJour: 0, tours: [] };
}

/** Temps au format chrono : 92.418 → « 1:32.418 ». */
export function formatLap(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(3).padStart(6, "0")}`;
}

/** Temps à dire à voix haute, sans ambiguïté pour la synthèse vocale : 92.418 → « 1 minute 32 secondes 4 ». */
export function speakLap(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  const whole = Math.floor(rest);
  const tenths = Math.floor((rest - whole) * 10 + 1e-6);
  return `${minutes > 0 ? `${minutes} minute${minutes > 1 ? "s" : ""} ` : ""}${whole} secondes ${tenths}`;
}

/** Écart signé à dire : 0.342 → « plus 3 dixièmes », -1.2 → « moins 1,2 ». */
export function speakDelta(delta: number): string {
  const abs = Math.abs(delta);
  if (abs < 0.05) return "même temps";
  const sign = delta < 0 ? "moins" : "plus";
  if (abs < 1) return `${sign} ${Math.max(1, Math.round(abs * 10))} dixième${Math.round(abs * 10) > 1 ? "s" : ""}`;
  return `${sign} ${abs.toFixed(1).replace(".", ",")}`;
}

export function speakGap(seconds: number): string {
  return seconds < 10 ? seconds.toFixed(1).replace(".", ",") : String(Math.round(seconds));
}
