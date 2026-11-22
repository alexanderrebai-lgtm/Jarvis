import { JsonStore } from "@muscu/jarvis/src/store.js";

/**
 * Coût et usage de Claude. Chaque appel du cerveau est compté par source
 * (conversation, surveillance d'écran, briefings, mails…). Les tâches qui
 * tournent toutes seules (écran, briefings, mails importants) consomment en
 * continu : savoir où part la consommation évite les surprises, et un plafond
 * par jour peut les mettre en pause.
 *
 * Avec un abonnement Claude, les montants sont un équivalent en dollars (rien
 * n'est facturé) mais chaque appel compte dans la limite d'utilisation ; avec
 * une clé API, c'est le coût réel.
 */

export interface UsageEntry {
  appels: number;
  usd: number;
  entree: number;
  sortie: number;
}

export interface UsageRecord {
  source: string;
  usd?: number | undefined;
  entree?: number | undefined;
  sortie?: number | undefined;
}

type Days = Record<string, Record<string, UsageEntry>>;

const vide = (): UsageEntry => ({ appels: 0, usd: 0, entree: 0, sortie: 0 });
const ajoute = (a: UsageEntry, b: UsageEntry): UsageEntry => ({ appels: a.appels + b.appels, usd: a.usd + b.usd, entree: a.entree + b.entree, sortie: a.sortie + b.sortie });
const arrondi = (n: number): number => Math.round(n * 10_000) / 10_000;

/** AAAA-MM-JJ en heure locale. */
export function jourLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface UsageSummary {
  aujourdhui: UsageEntry;
  mois: UsageEntry;
  /** Les derniers jours, du plus ancien au plus récent (jours sans appel inclus, à zéro). */
  jours: Array<{ jour: string } & UsageEntry>;
  /** Par source sur la période, de la plus coûteuse à la moins coûteuse. */
  parSource: Array<{ source: string } & UsageEntry>;
}

export class UsageStore {
  private readonly store: JsonStore<Days>;

  constructor(dataDir: string, private readonly now: () => Date = () => new Date()) {
    this.store = new JsonStore(dataDir, "usage", () => ({}));
  }

  record(rec: UsageRecord): void {
    const jour = jourLocal(this.now());
    const limite = jourLocal(new Date(this.now().getTime() - 95 * 86_400_000));
    this.store.update((all) => {
      const out: Days = {};
      for (const [j, v] of Object.entries(all)) if (j >= limite) out[j] = v;
      const du_jour = (out[jour] ??= {});
      du_jour[rec.source] = ajoute(du_jour[rec.source] ?? vide(), { appels: 1, usd: rec.usd ?? 0, entree: rec.entree ?? 0, sortie: rec.sortie ?? 0 });
      return out;
    });
  }

  summary(nbJours = 30): UsageSummary {
    const all = this.store.read();
    const maintenant = this.now();
    const jours: UsageSummary["jours"] = [];
    const parSource = new Map<string, UsageEntry>();
    for (let i = nbJours - 1; i >= 0; i--) {
      const jour = jourLocal(new Date(maintenant.getTime() - i * 86_400_000));
      let total = vide();
      for (const [source, e] of Object.entries(all[jour] ?? {})) {
        total = ajoute(total, e);
        parSource.set(source, ajoute(parSource.get(source) ?? vide(), e));
      }
      jours.push({ jour, ...total, usd: arrondi(total.usd) });
    }
    const moisPrefixe = jourLocal(maintenant).slice(0, 7);
    let mois = vide();
    for (const [j, v] of Object.entries(all)) if (j.startsWith(moisPrefixe)) for (const e of Object.values(v)) mois = ajoute(mois, e);
    const aujourdhui = jours[jours.length - 1] ?? { jour: jourLocal(maintenant), ...vide() };
    return {
      aujourdhui: { appels: aujourdhui.appels, usd: arrondi(aujourdhui.usd), entree: aujourdhui.entree, sortie: aujourdhui.sortie },
      mois: { ...mois, usd: arrondi(mois.usd) },
      jours,
      parSource: [...parSource.entries()].map(([source, e]) => ({ source, ...e, usd: arrondi(e.usd) })).sort((a, b) => b.usd - a.usd || b.appels - a.appels),
    };
  }

  /** Part du plafond du jour déjà consommée (0 à plus de 1) ; undefined sans plafond. */
  partDuPlafond(plafondUsd: number | undefined): number | undefined {
    if (!plafondUsd || plafondUsd <= 0) return undefined;
    return this.summary(1).aujourdhui.usd / plafondUsd;
  }
}

/** Phrase courte pour la voix ou Claude. */
export function phraseUsage(s: UsageSummary, plafondUsd?: number): string {
  const top = s.parSource.slice(0, 3).map((x) => `${x.source} (${x.appels} appel${x.appels > 1 ? "s" : ""}, ${x.usd.toFixed(2)} $)`).join(", ");
  const plafond = plafondUsd ? ` Plafond du jour : ${plafondUsd.toFixed(2)} $.` : "";
  return `Aujourd'hui : ${s.aujourdhui.appels} appel(s) à Claude, ${s.aujourdhui.usd.toFixed(2)} $. Ce mois-ci : ${s.mois.appels} appel(s), ${s.mois.usd.toFixed(2)} $.${top ? ` Sur 30 jours, ça part surtout dans : ${top}.` : ""}${plafond}`;
}
