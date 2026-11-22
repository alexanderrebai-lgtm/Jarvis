import { randomBytes } from "node:crypto";

/**
 * Approbation des actions sensibles. Quand Jarvis agit sans personne devant le PC
 * (tâche de fond, requête venue du téléphone), une action à risque (lancer une
 * commande PowerShell, piloter le clavier, mettre des fichiers à la corbeille…)
 * n'est faite que si Alex l'approuve. SANS RÉPONSE, C'EST REFUSÉ : une demande
 * oubliée ne doit jamais devenir une autorisation.
 *
 * Réglage « APPROBATION » :
 *  - « off »   : comme avant, Jarvis agit sans demander (défaut) ;
 *  - « taches » : seulement pour ce que font les tâches de fond (personne n'est là) ;
 *  - « tout »   : pour toute action sensible, d'où qu'elle vienne.
 */

export type ModeApprobation = "off" | "taches" | "tout";

/** Outils à risque (nom sans le préfixe mcp__jarvis__). */
export const SENSIBLES = new Set([
  "Bash", "PowerShell", "pc_powershell", "pc_clavier", "pc_souris", "pc_fermer_programme",
  "fichier_corbeille", "sauvegarde_restaurer", "securite_surveillance",
  "routine_enregistrer", "procedure_enregistrer", "tache_lancer",
]);

export function modeApprobation(valeur: string | undefined): ModeApprobation {
  return valeur === "tout" || valeur === "taches" ? valeur : "off";
}

/** Faut-il demander l'accord d'Alex pour cet outil, venu de cette source ? Fonction pure. */
export function exigeApprobation(mode: ModeApprobation, outil: string, source: string): boolean {
  if (mode === "off" || !SENSIBLES.has(outil)) return false;
  return mode === "tout" || source === "tâche de fond";
}

export type EtatDemande = "attente" | "approuvee" | "refusee" | "expiree";

export interface Demande {
  id: string;
  outil: string;
  resume: string;
  origine: string;
  creeLe: string;
  expireLe: string;
  etat: EtatDemande;
}

export interface ApprobationsOptions {
  /** Combien de temps on attend avant de refuser (ms). */
  delaiMs?: number;
  /** Prévient Alex (notification, Telegram, téléphone). */
  notifier: (d: Demande) => void;
  /** Garde une trace de la décision (journal des actions). */
  journaliser?: (d: Demande) => void;
  maintenant?: () => number;
}

export class Approbations {
  private readonly demandes = new Map<string, { d: Demande; fin: (ok: boolean) => void; minuteur: NodeJS.Timeout }>();
  private readonly historique: Demande[] = [];

  constructor(private readonly o: ApprobationsOptions) {}

  private now(): number {
    return this.o.maintenant?.() ?? Date.now();
  }

  /** Demande l'accord ; rend vrai seulement si Alex approuve avant l'expiration. */
  demander(outil: string, resume: string, origine: string): Promise<boolean> {
    const delai = this.o.delaiMs ?? 180_000;
    const d: Demande = { id: `ap${randomBytes(5).toString("hex")}`, outil, resume: resume.slice(0, 400), origine, creeLe: new Date(this.now()).toISOString(), expireLe: new Date(this.now() + delai).toISOString(), etat: "attente" };
    return new Promise<boolean>((resolve) => {
      const fin = (ok: boolean) => resolve(ok);
      const minuteur = setTimeout(() => this.conclure(d.id, "expiree"), delai);
      minuteur.unref?.();
      this.demandes.set(d.id, { d, fin, minuteur });
      this.o.notifier(d);
    });
  }

  private conclure(id: string, etat: Exclude<EtatDemande, "attente">): boolean {
    const e = this.demandes.get(id);
    if (!e) return false;
    clearTimeout(e.minuteur);
    this.demandes.delete(id);
    e.d.etat = etat;
    this.historique.unshift(e.d);
    this.historique.length = Math.min(this.historique.length, 30);
    this.o.journaliser?.(e.d);
    e.fin(etat === "approuvee");
    return true;
  }

  /** Alex répond ; faux si la demande n'existe plus (déjà traitée ou expirée). */
  repondre(id: string, accepte: boolean): boolean {
    return this.conclure(id, accepte ? "approuvee" : "refusee");
  }

  enAttente(): Demande[] {
    return [...this.demandes.values()].map((e) => e.d);
  }

  recentes(n = 10): Demande[] {
    return this.historique.slice(0, n);
  }
}
