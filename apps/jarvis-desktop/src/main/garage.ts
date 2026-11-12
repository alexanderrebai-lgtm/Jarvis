import { JsonStore, newId } from "@muscu/jarvis/src/store.js";

/**
 * Carnet d'entretien : véhicules, interventions (date, kilométrage, pièces,
 * coût) et plan d'entretien (tous les X km ou Y mois). Jarvis estime le
 * kilométrage du jour d'après ta moyenne et prévient avant l'échéance.
 */

export interface Vehicle {
  id: string;
  nom: string;
  marque?: string;
  modele?: string;
  annee?: number;
  moteur?: string;
  kilometrage: number;
  kmLe: string;
  immatriculation?: string;
  notes?: string;
}

export interface Service {
  id: string;
  vehicule: string;
  date: string;
  km: number;
  operation: string;
  details?: string;
  cout?: number;
  pieces?: string[];
}

export interface PlanItem {
  vehicule: string;
  operation: string;
  intervalleKm?: number;
  intervalleMois?: number;
}

interface GarageState {
  vehicules: Vehicle[];
  entretiens: Service[];
  plan: PlanItem[];
  releves: Array<{ vehicule: string; date: string; km: number }>;
}

export interface DueItem {
  vehicule: string;
  operation: string;
  etat: "en retard" | "bientôt" | "ok" | "jamais fait";
  dernier?: { date: string; km: number };
  prochainKm?: number;
  prochaineDate?: string;
  resteKm?: number;
  resteJours?: number;
}

function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function addMonths(date: string, months: number): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export class Garage {
  private readonly store: JsonStore<GarageState>;

  constructor(dataDir: string, private readonly now: () => Date = () => new Date()) {
    this.store = new JsonStore(dataDir, "garage", () => ({ vehicules: [], entretiens: [], plan: [], releves: [] }));
  }

  vehicles(): Vehicle[] {
    return this.store.read().vehicules;
  }

  find(name: string): Vehicle | undefined {
    const n = fold(name);
    const all = this.vehicles();
    return all.find((v) => fold(v.nom) === n || v.id === name) ?? all.find((v) => fold(`${v.nom} ${v.marque ?? ""} ${v.modele ?? ""} ${v.immatriculation ?? ""}`).includes(n)) ?? (all.length === 1 && !n ? all[0] : undefined);
  }

  private need(name: string): Vehicle {
    const v = this.find(name) ?? (this.vehicles().length === 1 ? this.vehicles()[0] : undefined);
    if (!v) throw new Error(`Véhicule « ${name} » inconnu. Véhicules : ${this.vehicles().map((x) => x.nom).join(", ") || "aucun"}.`);
    return v;
  }

  addVehicle(input: Omit<Vehicle, "id" | "kmLe">): Vehicle {
    const vehicle: Vehicle = { ...input, id: newId("veh"), kmLe: this.now().toISOString().slice(0, 10) };
    this.store.update((s) => ({ ...s, vehicules: [...s.vehicules, vehicle], releves: [...s.releves, { vehicule: vehicle.id, date: vehicle.kmLe, km: vehicle.kilometrage }] }));
    return vehicle;
  }

  updateVehicle(name: string, change: Partial<Omit<Vehicle, "id">>): Vehicle {
    const v = this.need(name);
    const next = { ...v, ...change };
    this.store.update((s) => ({ ...s, vehicules: s.vehicules.map((x) => (x.id === v.id ? next : x)) }));
    return next;
  }

  /** Nouveau relevé du compteur. */
  setMileage(name: string, km: number): Vehicle {
    const v = this.need(name);
    const date = this.now().toISOString().slice(0, 10);
    this.store.update((s) => ({ ...s, vehicules: s.vehicules.map((x) => (x.id === v.id ? { ...x, kilometrage: km, kmLe: date } : x)), releves: [...s.releves, { vehicule: v.id, date, km }] }));
    return { ...v, kilometrage: km, kmLe: date };
  }

  /** Kilomètres par jour, d'après les relevés (30 km/j par défaut). */
  kmPerDay(vehicleId: string): number {
    const r = this.store.read().releves.filter((x) => x.vehicule === vehicleId).sort((a, b) => a.date.localeCompare(b.date));
    if (r.length < 2) return 30;
    const first = r[0]!;
    const last = r.at(-1)!;
    const days = (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86_400_000;
    return days >= 7 ? Math.max(0, (last.km - first.km) / days) : 30;
  }

  /** Kilométrage estimé aujourd'hui. */
  estimatedKm(v: Vehicle): number {
    const days = (this.now().getTime() - new Date(v.kmLe).getTime()) / 86_400_000;
    return Math.round(v.kilometrage + Math.max(0, days) * this.kmPerDay(v.id));
  }

  addService(name: string, input: Omit<Service, "id" | "vehicule">): Service {
    const v = this.need(name);
    const service: Service = { ...input, id: newId("ent"), vehicule: v.id };
    this.store.update((s) => ({ ...s, entretiens: [...s.entretiens, service] }));
    if (input.km > v.kilometrage) this.setMileage(v.nom, input.km);
    return service;
  }

  history(name: string): Service[] {
    const v = this.need(name);
    return this.store
      .read()
      .entretiens.filter((e) => e.vehicule === v.id)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  setPlan(name: string, items: Array<Omit<PlanItem, "vehicule">>): PlanItem[] {
    const v = this.need(name);
    const plan = items.map((i) => ({ ...i, vehicule: v.id }));
    this.store.update((s) => ({ ...s, plan: [...s.plan.filter((p) => p.vehicule !== v.id), ...plan] }));
    return plan;
  }

  /** Ce qui est à faire, du plus urgent au moins urgent. */
  due(name?: string): DueItem[] {
    const state = this.store.read();
    const vehicles = name ? [this.need(name)] : state.vehicules;
    const today = this.now().toISOString().slice(0, 10);
    const out: DueItem[] = [];
    for (const v of vehicles) {
      const km = this.estimatedKm(v);
      for (const item of state.plan.filter((p) => p.vehicule === v.id)) {
        const op = fold(item.operation);
        const last = state.entretiens
          .filter((e) => e.vehicule === v.id && (fold(e.operation).includes(op) || op.includes(fold(e.operation))))
          .sort((a, b) => b.date.localeCompare(a.date))[0];
        if (!last) {
          out.push({ vehicule: v.nom, operation: item.operation, etat: "jamais fait" });
          continue;
        }
        const prochainKm = item.intervalleKm ? last.km + item.intervalleKm : undefined;
        const prochaineDate = item.intervalleMois ? addMonths(last.date, item.intervalleMois) : undefined;
        const resteKm = prochainKm !== undefined ? prochainKm - km : undefined;
        const resteJours = prochaineDate ? Math.round((new Date(prochaineDate).getTime() - new Date(today).getTime()) / 86_400_000) : undefined;
        const late = (resteKm !== undefined && resteKm <= 0) || (resteJours !== undefined && resteJours <= 0);
        const soon = (resteKm !== undefined && resteKm <= 1500) || (resteJours !== undefined && resteJours <= 30);
        out.push({
          vehicule: v.nom,
          operation: item.operation,
          etat: late ? "en retard" : soon ? "bientôt" : "ok",
          dernier: { date: last.date, km: last.km },
          ...(prochainKm !== undefined ? { prochainKm, resteKm } : {}),
          ...(prochaineDate ? { prochaineDate, resteJours } : {}),
        });
      }
    }
    const rank = { "en retard": 0, "jamais fait": 1, bientôt: 2, ok: 3 };
    return out.sort((a, b) => rank[a.etat] - rank[b.etat] || (a.resteKm ?? Infinity) - (b.resteKm ?? Infinity));
  }
}
