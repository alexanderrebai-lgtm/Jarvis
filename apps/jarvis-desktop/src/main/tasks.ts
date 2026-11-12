import { JsonStore, newId } from "@muscu/jarvis/src/store.js";

/**
 * Tâches de fond : une longue mission (recherche approfondie, analyse de
 * fichiers, projet complet) tourne à part, pendant qu'Alex continue de parler à
 * Jarvis. À la fin, Jarvis l'annonce et montre le résultat.
 */

export type TaskState = "attente" | "en_cours" | "terminee" | "echouee" | "annulee";

export interface BackgroundTask {
  id: string;
  titre: string;
  consigne: string;
  etat: TaskState;
  creeLe: string;
  debut?: string;
  fin?: string;
  etapes: string[];
  resultat?: string;
  erreur?: string;
  /** Page où montrer le résultat. */
  page?: "travail" | "rd" | "code" | "accueil";
}

export interface TaskRunner {
  (consigne: string, events: { onTool: (label: string) => void }, signal: AbortSignal): Promise<{ text: string; error?: string }>;
}

export class BackgroundTasks {
  private readonly store: JsonStore<BackgroundTask[]>;
  private readonly controllers = new Map<string, AbortController>();
  private readonly queue: string[] = [];

  constructor(
    private readonly options: {
      dataDir: string;
      run: TaskRunner;
      /** Une tâche a changé (pour l'affichage). */
      onUpdate?: (tasks: BackgroundTask[]) => void;
      /** Une tâche est finie (pour l'annoncer). */
      onDone?: (task: BackgroundTask) => void;
      concurrency?: number;
    },
  ) {
    this.store = new JsonStore(options.dataDir, "taches", () => []);
    // Au redémarrage, une tâche qui tournait est perdue : on le dit.
    this.store.update((all) => all.map((t) => (t.etat === "en_cours" || t.etat === "attente" ? { ...t, etat: "echouee", erreur: "Jarvis a redémarré pendant la tâche.", fin: new Date().toISOString() } : t)));
  }

  list(limit = 20): BackgroundTask[] {
    return this.store.read().slice(-limit).reverse();
  }

  get(id: string): BackgroundTask | undefined {
    return this.store.read().find((t) => t.id === id);
  }

  running(): BackgroundTask[] {
    return this.store.read().filter((t) => t.etat === "en_cours" || t.etat === "attente");
  }

  private patch(id: string, change: Partial<BackgroundTask>): void {
    this.store.update((all) => all.map((t) => (t.id === id ? { ...t, ...change } : t)).slice(-60));
    this.options.onUpdate?.(this.list());
  }

  launch(titre: string, consigne: string, page?: BackgroundTask["page"]): BackgroundTask {
    const task: BackgroundTask = { id: newId("tache"), titre, consigne, etat: "attente", creeLe: new Date().toISOString(), etapes: [], ...(page ? { page } : {}) };
    this.store.update((all) => [...all, task].slice(-60));
    this.queue.push(task.id);
    this.options.onUpdate?.(this.list());
    this.pump();
    return task;
  }

  cancel(id: string): boolean {
    const controller = this.controllers.get(id);
    const index = this.queue.indexOf(id);
    if (index !== -1) this.queue.splice(index, 1);
    if (controller) controller.abort();
    const task = this.get(id);
    if (!task || (task.etat !== "en_cours" && task.etat !== "attente")) return false;
    this.patch(id, { etat: "annulee", fin: new Date().toISOString() });
    return true;
  }

  private pump(): void {
    const limit = this.options.concurrency ?? 2;
    while (this.controllers.size < limit && this.queue.length) {
      const id = this.queue.shift()!;
      void this.execute(id);
    }
  }

  private async execute(id: string): Promise<void> {
    const task = this.get(id);
    if (!task || task.etat !== "attente") return;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.patch(id, { etat: "en_cours", debut: new Date().toISOString() });
    try {
      const reply = await this.options.run(task.consigne, { onTool: (label) => this.patch(id, { etapes: [...(this.get(id)?.etapes ?? []), label].slice(-30) }) }, controller.signal);
      if (controller.signal.aborted) return;
      if (reply.error && !reply.text) this.patch(id, { etat: "echouee", erreur: reply.error, fin: new Date().toISOString() });
      else this.patch(id, { etat: "terminee", resultat: reply.text, fin: new Date().toISOString() });
    } catch (error) {
      if (!controller.signal.aborted) this.patch(id, { etat: "echouee", erreur: error instanceof Error ? error.message : String(error), fin: new Date().toISOString() });
    } finally {
      this.controllers.delete(id);
      const done = this.get(id);
      if (done && done.etat !== "annulee") this.options.onDone?.(done);
      this.pump();
    }
  }
}
