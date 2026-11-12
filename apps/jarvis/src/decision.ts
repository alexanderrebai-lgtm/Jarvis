/**
 * Outils de calcul pour l'aide à la décision. Fonctions pures, sans réseau :
 * le modèle fournit les hypothèses (probabilités, gains, notes), le code fait
 * les calculs exacts pour qu'il n'ait jamais à les « estimer de tête ».
 */

export interface Scenario {
  description: string;
  probabilite: number;
  valeur: number;
}

export interface OptionScenarios {
  nom: string;
  scenarios: Scenario[];
}

export interface AnalyseOption {
  nom: string;
  esperance: number;
  ecartType: number;
  pire: number;
  meilleur: number;
  probabilitePerte: number;
  avertissements: string[];
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Espérance, risque (écart type) et probabilité de perte de chaque option, classées par espérance. */
export function analyseEsperance(options: OptionScenarios[]): AnalyseOption[] {
  return options
    .map((option) => {
      const avertissements: string[] = [];
      if (option.scenarios.length === 0) {
        return { nom: option.nom, esperance: 0, ecartType: 0, pire: 0, meilleur: 0, probabilitePerte: 0, avertissements: ["Aucun scénario fourni."] };
      }
      if (option.scenarios.some((s) => s.probabilite < 0)) {
        avertissements.push("Probabilité négative ramenée à 0.");
      }
      const probs = option.scenarios.map((s) => Math.max(0, s.probabilite));
      const total = probs.reduce((a, b) => a + b, 0);
      if (total === 0) {
        return { nom: option.nom, esperance: 0, ecartType: 0, pire: 0, meilleur: 0, probabilitePerte: 0, avertissements: ["Toutes les probabilités sont nulles."] };
      }
      if (Math.abs(total - 1) > 0.001) {
        avertissements.push(`Les probabilités totalisaient ${round(total, 3)} : elles ont été ramenées à 1.`);
      }
      const p = probs.map((value) => value / total);
      const valeurs = option.scenarios.map((s) => s.valeur);
      const esperance = valeurs.reduce((acc, v, i) => acc + v * p[i]!, 0);
      const variance = valeurs.reduce((acc, v, i) => acc + p[i]! * (v - esperance) ** 2, 0);
      const probabilitePerte = valeurs.reduce((acc, v, i) => acc + (v < 0 ? p[i]! : 0), 0);
      return {
        nom: option.nom,
        esperance: round(esperance),
        ecartType: round(Math.sqrt(variance)),
        pire: Math.min(...valeurs),
        meilleur: Math.max(...valeurs),
        probabilitePerte: round(probabilitePerte),
        avertissements,
      };
    })
    .sort((a, b) => b.esperance - a.esperance);
}

export interface Critere {
  nom: string;
  poids: number;
}

export interface OptionNotee {
  nom: string;
  /** Note de 0 à 10 par critère (clé = nom du critère). */
  notes: Record<string, number>;
}

export interface ResultatMatrice {
  nom: string;
  score: number;
  details: Record<string, number>;
  criteresManquants: string[];
}

/** Matrice de décision pondérée : score sur 10, poids normalisés. */
export function matriceDecision(criteres: Critere[], options: OptionNotee[]): ResultatMatrice[] {
  const totalPoids = criteres.reduce((acc, c) => acc + Math.max(0, c.poids), 0) || 1;
  return options
    .map((option) => {
      const details: Record<string, number> = {};
      const criteresManquants: string[] = [];
      let score = 0;
      for (const critere of criteres) {
        const note = option.notes[critere.nom];
        if (note === undefined) {
          criteresManquants.push(critere.nom);
          continue;
        }
        const bornee = Math.min(10, Math.max(0, note));
        const contribution = (bornee * Math.max(0, critere.poids)) / totalPoids;
        details[critere.nom] = round(contribution, 3);
        score += contribution;
      }
      return { nom: option.nom, score: round(score, 2), details, criteresManquants };
    })
    .sort((a, b) => b.score - a.score);
}

export interface Etape {
  nom: string;
  /** Probabilité la plus basse plausible (0 à 1). */
  min: number;
  /** Probabilité la plus haute plausible (0 à 1). */
  max: number;
}

export interface ResultatFaisabilite {
  /** Probabilité que toutes les étapes réussissent, avec les valeurs moyennes. */
  probabiliteCentrale: number;
  /** Percentiles 10, 50 et 90 issus de la simulation (incertitude sur les hypothèses). */
  p10: number;
  p50: number;
  p90: number;
  /** Étape qui pèse le plus sur l'échec : celle à améliorer en premier. */
  etapeCritique: string | undefined;
  simulations: number;
}

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[index]!;
}

/**
 * Faisabilité d'un projet dont toutes les étapes doivent réussir. Chaque étape a
 * une fourchette de probabilité ; une simulation de Monte-Carlo donne la
 * fourchette du résultat global.
 */
export function faisabilite(etapes: Etape[], simulations = 10000, random: () => number = Math.random): ResultatFaisabilite {
  const bornees = etapes.map((etape) => {
    const min = Math.min(1, Math.max(0, Math.min(etape.min, etape.max)));
    const max = Math.min(1, Math.max(0, Math.max(etape.min, etape.max)));
    return { nom: etape.nom, min, max, moyenne: (min + max) / 2 };
  });
  if (bornees.length === 0) {
    return { probabiliteCentrale: 0, p10: 0, p50: 0, p90: 0, etapeCritique: undefined, simulations: 0 };
  }
  const centrale = bornees.reduce((acc, e) => acc * e.moyenne, 1);
  const tirages: number[] = [];
  for (let i = 0; i < simulations; i += 1) {
    let produit = 1;
    for (const etape of bornees) produit *= etape.min + (etape.max - etape.min) * random();
    tirages.push(produit);
  }
  tirages.sort((a, b) => a - b);
  const critique = [...bornees].sort((a, b) => a.moyenne - b.moyenne)[0];
  return {
    probabiliteCentrale: round(centrale),
    p10: round(percentile(tirages, 0.1)),
    p50: round(percentile(tirages, 0.5)),
    p90: round(percentile(tirages, 0.9)),
    etapeCritique: critique?.nom,
    simulations,
  };
}

/** Probabilité qu'au moins un événement indépendant se produise (ex. au moins une réponse positive). */
export function auMoinsUn(probabilites: number[]): number {
  const aucun = probabilites.reduce((acc, p) => acc * (1 - Math.min(1, Math.max(0, p))), 1);
  return round(1 - aucun);
}
