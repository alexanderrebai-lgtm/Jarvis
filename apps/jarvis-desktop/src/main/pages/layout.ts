import { nameDisplays, type PageId, type ScreenName } from "./catalog.js";

/**
 * Calcul de l'emplacement de chaque page : sur plusieurs écrans, une page par
 * écran (ou partagé s'il le faut) ; sur un seul écran, l'écran est coupé en
 * moitiés ou en tiers. Pendant une partie, l'écran du jeu (celui du milieu)
 * reste libre.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  id: number;
  bounds: Rect;
  workArea: Rect;
  primary: boolean;
}

export interface Placement {
  page: PageId;
  ecran: ScreenName | "principal";
}

export interface WindowSpot {
  page: PageId;
  displayId: number;
  bounds: Rect;
  /** Seule page de son écran (avec plusieurs écrans) : plein écran. */
  fullscreen: boolean;
}

const ORDER: Record<ScreenName | "principal", number> = { gauche: 0, principal: 1, centre: 1, droite: 2 };

/** Coupe une zone en colonnes égales (bords arrondis au pixel, sans trou). */
export function splitColumns(area: Rect, count: number): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i < count; i += 1) {
    const x0 = Math.round(area.x + (area.width * i) / count);
    const x1 = Math.round(area.x + (area.width * (i + 1)) / count);
    out.push({ x: x0, y: area.y, width: x1 - x0, height: area.height });
  }
  return out;
}

export interface LayoutInput {
  displays: DisplayInfo[];
  /** Pages visibles (hors accueil de fond), dans l'ordre d'ouverture. */
  visible: Placement[];
  /** L'accueil sert de fond d'écran quand il n'est pas dans une disposition. */
  home?: Placement | undefined;
  /** Une partie est en cours : l'écran du jeu reste libre (s'il y en a d'autres). */
  gameRunning?: boolean;
}

export function computeLayout(input: LayoutInput): WindowSpot[] {
  const { displays } = input;
  if (displays.length === 0) return [];
  const named = nameDisplays(displays);
  const single = displays.length === 1;
  const gameDisplay = input.gameRunning && !single ? named.centre : undefined;

  // Écran physique de chaque page, en évitant celui du jeu.
  const byDisplay = new Map<number, Placement[]>();
  for (const p of input.visible) {
    let display = named[p.ecran];
    if (gameDisplay && display.id === gameDisplay.id) {
      const others = displays.filter((d) => d.id !== gameDisplay.id);
      // L'écran libre le moins chargé ; à égalité, celui de gauche.
      others.sort((a, b) => (byDisplay.get(a.id)?.length ?? 0) - (byDisplay.get(b.id)?.length ?? 0) || a.bounds.x - b.bounds.x);
      display = others[0]!;
    }
    const list = byDisplay.get(display.id) ?? [];
    list.push(p);
    byDisplay.set(display.id, list);
  }

  const spots: WindowSpot[] = [];
  for (const display of displays) {
    const list = byDisplay.get(display.id);
    if (!list?.length) continue;
    // Sur un écran partagé, la page « de gauche » est à gauche.
    const ordered = list.map((p, i) => ({ p, i })).sort((a, b) => ORDER[a.p.ecran] - ORDER[b.p.ecran] || a.i - b.i);
    const alone = ordered.length === 1;
    const area = alone && !single ? display.bounds : display.workArea;
    const columns = splitColumns(area, ordered.length);
    ordered.forEach(({ p }, i) => spots.push({ page: p.page, displayId: display.id, bounds: columns[i]!, fullscreen: alone && !single }));
  }

  if (input.home) {
    let display = named[input.home.ecran];
    // Le fond d'accueil évite l'écran du jeu et préfère un écran sans page.
    if (gameDisplay && display.id === gameDisplay.id) {
      const free = displays.filter((d) => d.id !== gameDisplay.id).sort((a, b) => (byDisplay.get(a.id)?.length ?? 0) - (byDisplay.get(b.id)?.length ?? 0));
      if (free[0]) display = free[0];
    }
    const alone = !byDisplay.get(display.id)?.length;
    spots.unshift({ page: input.home.page, displayId: display.id, bounds: alone && !single ? display.bounds : display.workArea, fullscreen: alone && !single });
  }
  return spots;
}

/** Nombre maximal de pages côte à côte sur un même écran. */
export const MAX_PER_DISPLAY = 3;

/**
 * Ajoute des pages aux pages visibles. Sur un seul écran, au plus `maxSplit`
 * pages côte à côte (les plus anciennes se cachent) ; sur plusieurs écrans, une
 * page remplace celle qui occupait son écran, sauf si elles sont demandées
 * ensemble (elles se répartissent alors sur les écrans libres).
 */
export function addPages(options: {
  visible: Placement[];
  requested: Placement[];
  displayCount: number;
  gameRunning?: boolean;
  maxSplit?: number;
}): { visible: Placement[]; hidden: PageId[] } {
  const { requested, displayCount } = options;
  const maxSplit = options.maxSplit ?? 2;
  const ids = new Set(requested.map((r) => r.page));
  let visible = options.visible.filter((v) => !ids.has(v.page));
  const hidden: PageId[] = [];

  if (displayCount <= 1) {
    const next = [...visible, ...requested];
    const keep = Math.max(maxSplit, Math.min(requested.length, MAX_PER_DISPLAY));
    while (next.length > keep) hidden.push(next.shift()!.page);
    return { visible: next, hidden };
  }

  // Plusieurs écrans : on répartit les pages demandées ensemble sur des emplacements différents.
  const slots: ScreenName[] = displayCount >= 3 ? (options.gameRunning ? ["gauche", "droite"] : ["gauche", "centre", "droite"]) : ["gauche", "droite"];
  const slotOf = (e: Placement["ecran"]): ScreenName => (e === "principal" ? (displayCount >= 3 ? "centre" : "gauche") : displayCount < 3 && e === "centre" ? "gauche" : e);
  const taken = new Set<ScreenName>();
  const placed: Placement[] = [];
  for (const r of requested) {
    let slot = slotOf(r.ecran);
    if (options.gameRunning && displayCount >= 3 && slot === "centre") slot = "gauche";
    if (taken.has(slot)) slot = slots.find((s) => !taken.has(s)) ?? slot;
    taken.add(slot);
    placed.push({ page: r.page, ecran: slot });
  }
  visible = visible.filter((v) => {
    if (taken.has(slotOf(v.ecran))) {
      hidden.push(v.page);
      return false;
    }
    return true;
  });
  return { visible: [...visible, ...placed], hidden };
}

/** Échange les emplacements : gauche ↔ droite (et le centre suit sur trois écrans). */
export function swapPlacements(visible: Placement[], displayCount: number, direction: "gauche" | "droite" = "droite"): Placement[] {
  if (visible.length === 0) return visible;
  if (displayCount <= 1) {
    // Un seul écran : on fait tourner l'ordre des colonnes.
    const ordered = [...visible].sort((a, b) => ORDER[a.ecran] - ORDER[b.ecran]);
    const rotated = direction === "droite" ? [ordered.at(-1)!, ...ordered.slice(0, -1)] : [...ordered.slice(1), ordered[0]!];
    const slots: ScreenName[] = rotated.length === 2 ? ["gauche", "droite"] : ["gauche", "centre", "droite"];
    return rotated.map((p, i) => ({ page: p.page, ecran: slots[Math.min(i, slots.length - 1)]! }));
  }
  const ring: ScreenName[] = displayCount >= 3 ? ["gauche", "centre", "droite"] : ["gauche", "droite"];
  const step = direction === "droite" ? 1 : -1;
  return visible.map((p) => {
    const index = ring.indexOf(p.ecran === "principal" ? (displayCount >= 3 ? "centre" : "gauche") : p.ecran);
    return { page: p.page, ecran: ring[(index + step + ring.length) % ring.length]! };
  });
}

/** Déplace une page d'un cran vers la gauche ou la droite. */
export function shiftPlacement(visible: Placement[], page: PageId, direction: "gauche" | "droite", displayCount: number): Placement[] {
  const ring: ScreenName[] = displayCount >= 3 ? ["gauche", "centre", "droite"] : ["gauche", "droite"];
  const current = visible.find((p) => p.page === page);
  if (!current) return visible;
  const index = Math.max(0, ring.indexOf(current.ecran === "principal" ? "centre" : current.ecran));
  const target = ring[Math.min(ring.length - 1, Math.max(0, index + (direction === "droite" ? 1 : -1)))]!;
  if (target === current.ecran) return visible;
  // La page qui était à l'arrivée prend la place libérée.
  return visible.map((p) => (p.page === page ? { page, ecran: target } : p.ecran === target ? { page: p.page, ecran: current.ecran } : p));
}
