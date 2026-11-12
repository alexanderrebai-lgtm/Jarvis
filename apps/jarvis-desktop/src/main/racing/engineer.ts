import type { EventF1 } from "./f1.js";
import { formatLap, speakDelta, speakGap, speakLap, type RaceState } from "./state.js";

/**
 * L'ingénieur de course : il observe l'état de la voiture et parle à la radio
 * au bon moment, brièvement. Règles simples et prévisibles (pas d'IA ici) pour
 * réagir instantanément ; les questions complexes passent par Claude.
 */

export type Verbosity = "minimal" | "normal" | "bavard";
export type Priority = "info" | "important" | "critique";

export interface RadioMessage {
  text: string;
  priority: Priority;
}

export interface EngineerOptions {
  verbosity: Verbosity;
  name: string;
}

const TYRES = ["avant gauche", "avant droit", "arrière gauche", "arrière droit"];

/** Seuils de température de surface des pneus (°C) au-delà desquels on prévient. */
const TYRE_HOT: Record<string, number> = { F1: 108, LMU: 105 };

export class RaceEngineer {
  private lastLap = 0;
  private lastPosition: number | undefined;
  private lastPitStops = 0;
  private warnedFuel = new Set<string>();
  private warnedWear = new Set<string>();
  private lastHotWarning = -Infinity;
  private knownDamage: Record<string, number> = {};
  private lastFlag: string | undefined;
  private pitWindowSaid = false;
  private rainSaid = false;
  private lastBattleWarning = -Infinity;
  private sessionKey = "";

  constructor(private readonly options: EngineerOptions, private readonly now: () => number = Date.now) {}

  /** Analyse un nouvel état ; renvoie ce qu'il faut dire maintenant (souvent rien). */
  update(state: RaceState, event?: EventF1): RadioMessage[] {
    const out: RadioMessage[] = [];
    const key = `${state.jeu}|${state.piste}|${state.session}`;
    if (key !== this.sessionKey) {
      this.reset();
      this.sessionKey = key;
      this.lastPosition = state.position;
    }
    if (event) out.push(...this.onEvent(event));

    // Nouvel arrêt au stand : nouveaux pneus, on réarme les alertes du relais.
    const stops = state.stand?.arrets ?? 0;
    if (stops > this.lastPitStops) {
      this.lastPitStops = stops;
      this.warnedWear.clear();
      this.warnedFuel.clear();
      this.knownDamage = {};
    }

    const lastLap = state.tours.at(-1);
    if (lastLap && lastLap.numero !== this.lastLap) {
      this.lastLap = lastLap.numero;
      out.push(...this.onLap(state));
    }

    out.push(...this.flags(state), ...this.tyres(state), ...this.damage(state), ...this.battle(state), ...this.weather(state));
    return out;
  }

  private reset(): void {
    this.lastLap = 0;
    this.lastPitStops = 0;
    this.warnedFuel.clear();
    this.warnedWear.clear();
    this.knownDamage = {};
    this.lastFlag = undefined;
    this.pitWindowSaid = false;
    this.rainSaid = false;
  }

  private onLap(state: RaceState): RadioMessage[] {
    const out: RadioMessage[] = [];
    const lap = state.tours.at(-1)!;
    const best = state.meilleurTourS;
    const v = this.options.verbosity;
    const isBest = lap.valide && best !== undefined && Math.abs(lap.tempsS - best) < 0.0005 && state.tours.filter((t) => t.valide).length > 1;

    if (!lap.valide) {
      if (v !== "minimal") out.push({ text: `Tour ${lap.numero} invalidé.`, priority: "info" });
    } else if (isBest) {
      out.push({ text: `${speakLap(lap.tempsS)}, meilleur tour ! Superbe.`, priority: "important" });
    } else if (v !== "minimal" && best !== undefined && state.tours.filter((t) => t.valide).length > 1) {
      out.push({ text: `${speakLap(lap.tempsS)}, ${speakDelta(lap.tempsS - best)}.`, priority: "info" });
    } else if (v !== "minimal") {
      out.push({ text: `${speakLap(lap.tempsS)}.`, priority: "info" });
    }

    // Positions gagnées ou perdues dans le tour.
    if (state.enCourse && state.position !== undefined && this.lastPosition !== undefined && state.position !== this.lastPosition) {
      const gained = this.lastPosition - state.position;
      out.push({ text: gained > 0 ? `P${state.position}, tu as gagné ${gained > 1 ? `${gained} places` : "une place"}.` : `P${state.position}.`, priority: "info" });
    }
    this.lastPosition = state.position;

    out.push(...this.fuel(state));

    // Point régulier en course : position et écarts.
    if (state.enCourse && v !== "minimal" && lap.numero % (v === "bavard" ? 3 : 5) === 0) {
      const parts = [`Tour ${lap.numero}${state.totalTours ? ` sur ${state.totalTours}` : ""}, P${state.position}`];
      if (state.ecartDevantS !== undefined) parts.push(`${speakGap(state.ecartDevantS)} devant`);
      if (state.ecartDerriereS !== undefined) parts.push(`${speakGap(state.ecartDerriereS)} derrière`);
      out.push({ text: `${parts.join(", ")}.`, priority: "info" });
    }

    // Fenêtre d'arrêt conseillée par le jeu (F1).
    if (state.enCourse && !this.pitWindowSaid && state.stand?.tourIdeal && state.tour !== undefined && state.tour >= state.stand.tourIdeal) {
      this.pitWindowSaid = true;
      out.push({ text: `Fenêtre d'arrêt ouverte. Le plus tard, c'est le tour ${state.stand.tourMax ?? state.stand.tourIdeal}.`, priority: "important" });
    }

    // Dernier tour.
    if (state.enCourse && state.totalTours && state.tour === state.totalTours) {
      out.push({ text: "Dernier tour, ramène-la à la maison.", priority: "important" });
    }
    return out;
  }

  private fuel(state: RaceState): RadioMessage[] {
    const out: RadioMessage[] = [];
    if (!state.enCourse) return out;
    const remainingLaps = state.totalTours && state.tour ? state.totalTours - state.tour + 1 : undefined;
    // F1 : le jeu donne directement la marge en tours (positive = de l'avance).
    const margin = state.carburant?.margeTours ?? (remainingLaps !== undefined && state.carburant?.toursRestants !== undefined ? state.carburant.toursRestants - remainingLaps : undefined);
    if (margin !== undefined && margin < -0.3 && !this.warnedFuel.has("court")) {
      this.warnedFuel.add("court");
      out.push({ text: `Attention au carburant : il en manque environ ${speakGap(-margin)} tour${-margin >= 2 ? "s" : ""}. Économise en levant avant les freinages.`, priority: "critique" });
    } else if (margin !== undefined && margin > 0.3 && margin < 1 && !this.warnedFuel.has("juste")) {
      this.warnedFuel.add("juste");
      out.push({ text: "Carburant un peu juste, mais ça passe si tu restes régulier.", priority: "important" });
    }
    // Endurance : autonomie en carburant ou en énergie virtuelle.
    const autonomy = Math.min(state.carburant?.toursRestants ?? Infinity, state.energie?.toursRestants ?? Infinity);
    for (const threshold of [3, 1.5]) {
      if (autonomy <= threshold && autonomy > 0 && !this.warnedFuel.has(`auto${threshold}`) && (remainingLaps === undefined || remainingLaps > autonomy)) {
        this.warnedFuel.add(`auto${threshold}`);
        const what = state.energie?.toursRestants === autonomy ? "d'énergie" : "de carburant";
        out.push({ text: threshold <= 1.5 ? `Box, box ! Plus qu'un tour ${what}.` : `Il te reste environ ${Math.floor(autonomy)} tours ${what}, prépare l'arrêt.`, priority: threshold <= 1.5 ? "critique" : "important" });
      }
    }
    return out;
  }

  private tyres(state: RaceState): RadioMessage[] {
    const out: RadioMessage[] = [];
    const wear = state.pneus?.usure;
    if (wear) {
      const worst = wear.indexOf(Math.max(...wear));
      for (const threshold of [55, 70, 85]) {
        if (wear[worst]! >= threshold && !this.warnedWear.has(String(threshold))) {
          this.warnedWear.add(String(threshold));
          out.push({ text: `Pneus : ${TYRES[worst]} à ${Math.round(wear[worst]!)} % d'usure${threshold >= 85 ? ", ils sont finis, rentre dès que possible" : threshold >= 70 ? ", ménage-les" : ""}.`, priority: threshold >= 70 ? "important" : "info" });
        }
      }
    }
    const surface = state.pneus?.surface;
    const hot = TYRE_HOT[state.jeu] ?? 105;
    if (surface && this.now() - this.lastHotWarning > 120_000) {
      const worst = surface.indexOf(Math.max(...surface));
      if (surface[worst]! > hot && state.tourActuelS !== undefined && state.tourActuelS > 5) {
        this.lastHotWarning = this.now();
        out.push({ text: `Le pneu ${TYRES[worst]} surchauffe, ${Math.round(surface[worst]!)} degrés. Calme les glissades.`, priority: "info" });
      }
    }
    return out;
  }

  private damage(state: RaceState): RadioMessage[] {
    const out: RadioMessage[] = [];
    for (const [part, value] of Object.entries(state.degats ?? {})) {
      const before = this.knownDamage[part] ?? 0;
      if (value >= before + 15 && value >= 15) {
        out.push({ text: `Dégâts : ${part} à ${value} %.${value >= 50 && part.includes("aileron") ? " Il faut rentrer changer l'aileron." : ""}`, priority: value >= 40 ? "critique" : "important" });
        this.knownDamage[part] = value;
      } else if (value < before) this.knownDamage[part] = value;
    }
    return out;
  }

  private flags(state: RaceState): RadioMessage[] {
    const flag = state.drapeau;
    if (!flag || flag === this.lastFlag) return [];
    const previous = this.lastFlag;
    this.lastFlag = flag;
    if (previous === undefined && flag === "vert") return [];
    const say: Record<string, RadioMessage> = {
      safety_car: { text: "Voiture de sécurité ! On réfléchit à l'arrêt.", priority: "critique" },
      vsc: { text: "Voiture de sécurité virtuelle, respecte le delta.", priority: "critique" },
      rouge: { text: "Drapeau rouge, retour aux stands.", priority: "critique" },
      jaune: { text: "Drapeau jaune, prudence.", priority: "important" },
      bleu: { text: "Drapeau bleu, laisse passer.", priority: "important" },
      damier: { text: state.enCourse && state.position ? `Drapeau à damier ! Tu finis P${state.position}. Beau boulot.` : "Drapeau à damier.", priority: "important" },
      vert: { text: previous === "safety_car" || previous === "vsc" ? "Fin de la neutralisation, drapeau vert, attaque !" : "Drapeau vert.", priority: "important" },
    };
    if (flag === "vert" && previous !== "safety_car" && previous !== "vsc" && previous !== "rouge") return [];
    return say[flag] ? [say[flag]!] : [];
  }

  /** Bagarre : quelqu'un revient dans la seconde, ou tu es dans la seconde du pilote devant. */
  private battle(state: RaceState): RadioMessage[] {
    if (!state.enCourse || this.options.verbosity === "minimal" || this.now() - this.lastBattleWarning < 90_000) return [];
    if (state.ecartDerriereS !== undefined && state.ecartDerriereS < 0.8 && state.ecartDerriereS > 0) {
      this.lastBattleWarning = this.now();
      return [{ text: `${state.pilotes?.derriere ?? "La voiture derrière"} est à ${speakGap(state.ecartDerriereS)}, défends.`, priority: "info" }];
    }
    if (state.ecartDevantS !== undefined && state.ecartDevantS < 1 && state.ecartDevantS > 0) {
      this.lastBattleWarning = this.now();
      return [{ text: `Tu es dans la seconde${state.pilotes?.devant ? ` de ${state.pilotes.devant}` : ""}${state.jeu === "F1" ? ", DRS" : ""}.`, priority: "info" }];
    }
    return [];
  }

  private onEvent(event: EventF1): RadioMessage[] {
    switch (event.code) {
      case "PENA":
        return [{ text: event.timeS ? `Pénalité de ${event.timeS} secondes.` : "Avertissement de la direction de course.", priority: "important" }];
      case "OVTK":
        return [];
      case "COLL":
        return [{ text: `Contact${event.otherName ? ` avec ${event.otherName}` : ""}. Tout va bien ?`, priority: "important" }];
      case "DRSE":
        return this.options.verbosity === "bavard" ? [{ text: "DRS activé.", priority: "info" }] : [];
      case "SSTA":
        return [{ text: `Séance lancée. Je suis avec toi, ${this.options.name}.`, priority: "info" }];
      default:
        return [];
    }
  }

  /** Annonce de pluie (F1) : prévision pour les prochaines minutes. */
  weather(state: RaceState): RadioMessage[] {
    const rain = state.meteo?.pluieProchainePct;
    if (rain !== undefined && rain >= 50 && !this.rainSaid) {
      this.rainSaid = true;
      return [{ text: `Pluie annoncée à ${rain} % dans les prochaines minutes. Pense aux intermédiaires.`, priority: "important" }];
    }
    return [];
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Réponses immédiates aux questions courantes à la radio. Undefined = la question part vers Claude. */
export function quickAnswer(question: string, state: RaceState): string | undefined {
  if (!state.actif) return undefined;
  const q = normalize(question);
  const fuelText = () => {
    const c = state.carburant;
    if (!c) return undefined;
    const parts: string[] = [];
    if (c.margeTours !== undefined) parts.push(c.margeTours >= 0 ? `Tu as ${speakGap(c.margeTours)} tour d'avance en carburant` : `Il te manque ${speakGap(-c.margeTours)} tour de carburant`);
    else if (c.toursRestants !== undefined) parts.push(`Il te reste ${Math.floor(c.toursRestants)} tours de carburant`);
    if (c.restant !== undefined) parts.push(`${c.restant.toLocaleString("fr-FR")} ${c.unite === "kg" ? "kilos" : "litres"} dans le réservoir`);
    if (c.parTour !== undefined) parts.push(`${c.parTour.toLocaleString("fr-FR")} par tour`);
    return parts.length ? `${parts.join(", ")}.` : undefined;
  };
  if (/(essence|carburant|fuel|reservoir|conso)/.test(q)) return fuelText() ?? "Je n'ai pas encore assez de tours pour estimer la consommation.";
  if (/(energie|batterie|virtual|\bve\b|ers)/.test(q)) {
    const e = state.energie;
    if (!e) return undefined;
    return `Énergie à ${Math.round(e.fraction * 100)} %${e.toursRestants !== undefined ? `, environ ${Math.floor(e.toursRestants)} tours d'autonomie` : ""}${e.parTour !== undefined ? `, ${Math.round(e.parTour * 1000) / 10} % par tour` : ""}.`;
  }
  if (/(pneu|gomme|usure|tyre)/.test(q)) {
    const p = state.pneus;
    if (!p) return undefined;
    const parts: string[] = [];
    if (p.compose) parts.push(`Tu es en ${p.compose}${p.age !== undefined ? ` de ${p.age} tours` : ""}`);
    if (p.usure) {
      const worst = p.usure.indexOf(Math.max(...p.usure));
      parts.push(`le plus usé est l'${TYRES[worst]} à ${Math.round(p.usure[worst]!)} %`);
    }
    if (p.surface) parts.push(`températures ${p.surface.map((t) => Math.round(t)).join(", ")} degrés`);
    return parts.length ? `${parts.join(", ")}.` : undefined;
  }
  if (/(ecart|gap|devant|derriere|qui est)/.test(q)) {
    const parts: string[] = [];
    if (state.ecartDevantS !== undefined) parts.push(`${speakGap(state.ecartDevantS)} sur ${state.pilotes?.devant ?? "la voiture devant"}`);
    if (state.ecartDerriereS !== undefined) parts.push(`${speakGap(state.ecartDerriereS)} d'avance sur ${state.pilotes?.derriere ?? "la voiture derrière"}`);
    return parts.length ? `${parts.join(", ")}.` : state.position === 1 ? "Tu es en tête, personne devant." : undefined;
  }
  if (/(position|place|classement|combien.*(je suis|suis-je))/.test(q)) {
    return state.position ? `P${state.position}${state.nbVoitures ? ` sur ${state.nbVoitures}` : ""}${state.classe ? ` en ${state.classe}` : ""}.` : undefined;
  }
  if (/(meilleur tour|dernier tour|chrono|temps au tour|mon temps)/.test(q)) {
    return `Dernier tour ${formatLap(state.dernierTourS)}, meilleur ${formatLap(state.meilleurTourS)}.`;
  }
  if (/(tours? restants?|combien de tours|reste.*tours?|temps restant)/.test(q)) {
    if (state.totalTours && state.tour) return `Encore ${state.totalTours - state.tour + 1} tours, celui-ci compris.`;
    if (state.tempsRestantS) return `Encore ${Math.round(state.tempsRestantS / 60)} minutes.`;
    return undefined;
  }
  if (/(degat|aileron|casse|abime)/.test(q)) {
    const hurt = Object.entries(state.degats ?? {}).filter(([, v]) => v > 0);
    return hurt.length ? `${hurt.map(([k, v]) => `${k} ${v} %`).join(", ")}.` : "Aucun dégât, la voiture est intacte.";
  }
  if (/(meteo|pluie|pleuvoir)/.test(q)) {
    const m = state.meteo;
    if (!m) return undefined;
    return `Piste à ${m.pisteC ?? "?"} degrés${m.pluieProchainePct !== undefined ? `, ${m.pluieProchainePct} % de risque de pluie` : ""}.`;
  }
  return undefined;
}

/** Résumé de fin de séance, enregistré dans le journal et lu à Alex. */
export function debrief(state: RaceState): string {
  const valid = state.tours.filter((t) => t.valide);
  if (state.tours.length === 0) return "";
  const best = valid.length ? Math.min(...valid.map((t) => t.tempsS)) : undefined;
  const sorted = [...valid].map((t) => t.tempsS).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : undefined;
  const mean = valid.reduce((acc, t) => acc + t.tempsS, 0) / Math.max(1, valid.length);
  const consistency = valid.length >= 3 ? Math.sqrt(valid.reduce((acc, t) => acc + (t.tempsS - mean) ** 2, 0) / valid.length) : undefined;
  const parts = [
    `${state.session ?? "Séance"} à ${state.piste ?? "?"} (${state.jeu}) : ${state.tours.length} tours, ${state.tours.length - valid.length} invalidés.`,
    best !== undefined ? `Meilleur tour ${formatLap(best)}, tour médian ${formatLap(median)}.` : "",
    consistency !== undefined ? `Régularité : ${consistency.toFixed(2)} s d'écart type.` : "",
    state.enCourse && state.position ? `Arrivée P${state.position}${state.nbVoitures ? ` sur ${state.nbVoitures}` : ""}.` : "",
    state.carburant?.parTour !== undefined ? `Consommation ${state.carburant.parTour} ${state.carburant.unite} par tour.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

/** Tours de la séance au format CSV (pour l'analyse par Jarvis ou dans Excel). */
export function lapsCsv(state: RaceState): string {
  const rows = state.tours.map((t) => [t.numero, t.tempsS.toFixed(3), t.valide ? "oui" : "non", t.position ?? "", t.carburant ?? "", t.energie ?? ""].join(";"));
  return ["tour;temps_s;valide;position;carburant;energie", ...rows].join("\n");
}
