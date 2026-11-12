import { BrowserWindow, screen, type WebPreferences } from "electron";
import { JsonStore } from "@muscu/jarvis/src/store.js";
import { PAGES, pageInfo, type PageId, type ScreenName } from "./catalog.js";
import type { Disposition } from "./dispositions.js";
import { addPages, computeLayout, shiftPlacement, swapPlacements, type DisplayInfo, type Placement, type WindowSpot } from "./layout.js";

/**
 * Fenêtres des pages. L'accueil est le fond permanent ; les autres pages
 * s'ouvrent sur demande, seules ou à plusieurs (moitiés ou tiers d'écran avec un
 * seul écran, une par écran sinon). Pendant une partie, l'écran du jeu reste
 * libre et Jarvis ne prend plus le premier plan.
 */

type Remembered = Partial<Record<PageId, ScreenName | "principal">>;

export interface PageManagerOptions {
  dataDir: string;
  url: (page: PageId) => string;
  webPreferences: WebPreferences;
  icon: string;
  onOpen?: (page: PageId) => void;
  onClose?: (page: PageId) => void;
  /** Vrai quand Jarvis quitte : la fenêtre d'accueil ne doit plus se cacher. */
  quitting: () => boolean;
}

export class PageManager {
  private readonly windows = new Map<PageId, BrowserWindow>();
  private readonly remembered: JsonStore<Remembered>;
  /** Pages visibles, dans l'ordre d'ouverture (l'accueil n'y est que s'il fait partie d'une disposition). */
  private visible: Placement[] = [];
  private game = false;
  private lastFocused: PageId | undefined;

  constructor(private readonly options: PageManagerOptions) {
    this.remembered = new JsonStore(options.dataDir, "ecrans", () => ({}));
  }

  get open(): PageId[] {
    return [...this.windows.keys()].filter((id) => this.windows.get(id)?.isVisible());
  }

  get gameRunning(): boolean {
    return this.game;
  }

  window(id: PageId): BrowserWindow | undefined {
    const win = this.windows.get(id);
    return win && !win.isDestroyed() ? win : undefined;
  }

  all(): BrowserWindow[] {
    return [...this.windows.values()].filter((w) => !w.isDestroyed());
  }

  screenOf(id: PageId): ScreenName | "principal" {
    return this.visible.find((v) => v.page === id)?.ecran ?? this.remembered.read()[id] ?? pageInfo(id).ecranParDefaut;
  }

  /** Disposition actuelle, pour que Jarvis sache où sont les pages. */
  layout(): { ecrans: number; jeuEnCours: boolean; pages: Array<{ page: PageId; titre: string; ecran: string; ouverte: boolean }> } {
    return {
      ecrans: screen.getAllDisplays().length,
      jeuEnCours: this.game,
      pages: PAGES.map((p) => ({ page: p.id, titre: p.titre, ecran: this.screenOf(p.id), ouverte: this.open.includes(p.id) })),
    };
  }

  /** Pages visibles et leur place (pour enregistrer la disposition actuelle). */
  current(): Placement[] {
    return this.visible.map((v) => ({ ...v }));
  }

  private displays(): DisplayInfo[] {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, primary: d.id === primary }));
  }

  private homeInLayout(): boolean {
    return this.visible.some((v) => v.page === "accueil");
  }

  /** Ouvre une page (seule sur son écran, ou à côté de l'autre page avec un seul écran). */
  openPage(id: PageId, target?: ScreenName | "principal", options: { show?: boolean; focus?: boolean } = {}): BrowserWindow {
    if (id === "accueil" && !this.homeInLayout()) {
      const win = this.ensureWindow("accueil");
      this.relayout();
      if (options.show !== false) this.reveal("accueil", options.focus ?? false);
      return win;
    }
    return this.openPages([id], target, options)[0]!;
  }

  /** Ouvre plusieurs pages ensemble (« ouvre le code et la R&D »). */
  openPages(ids: PageId[], target?: ScreenName | "principal", options: { show?: boolean; focus?: boolean } = {}): BrowserWindow[] {
    if (target && ids.length === 1) this.remembered.update((p) => ({ ...p, [ids[0]!]: target }));
    const requested = ids.map((page, i) => ({ page, ecran: (ids.length === 1 && target) || (i === 0 && target) || this.remembered.read()[page] || pageInfo(page).ecranParDefaut }));
    const { visible, hidden } = addPages({ visible: this.visible, requested, displayCount: screen.getAllDisplays().length, gameRunning: this.game });
    this.visible = visible;
    for (const page of hidden) this.hide(page);
    const wins = ids.map((id) => this.ensureWindow(id));
    this.relayout();
    if (options.show !== false) ids.forEach((id, i) => this.reveal(id, (options.focus ?? true) && i === ids.length - 1));
    return wins;
  }

  /** Applique une disposition enregistrée : ses pages à leur place, les autres se cachent. */
  applyDisposition(disposition: Disposition): void {
    const keep = new Set(disposition.pages.map((p) => p.page));
    for (const v of this.visible) if (!keep.has(v.page)) this.hide(v.page);
    for (const id of this.open) if (id !== "accueil" && !keep.has(id)) this.hide(id);
    this.visible = disposition.pages.map((p) => ({ ...p }));
    for (const p of disposition.pages) this.ensureWindow(p.page);
    this.ensureWindow("accueil");
    this.relayout();
    disposition.pages.forEach((p, i) => this.reveal(p.page, i === disposition.pages.length - 1));
  }

  move(id: PageId, target: ScreenName | "principal"): void {
    this.remembered.update((p) => ({ ...p, [id]: target }));
    const index = this.visible.findIndex((v) => v.page === id);
    if (index === -1) return;
    // La page qui occupait la place prend celle qui se libère.
    const previous = this.visible[index]!.ecran;
    this.visible = this.visible.map((v) => (v.page === id ? { page: id, ecran: target } : v.ecran === target ? { page: v.page, ecran: previous } : v));
    this.relayout();
  }

  /** « Échange » : les pages tournent d'une place (geste de balayage ou à la voix). */
  swap(direction: "gauche" | "droite" = "droite"): boolean {
    if (this.visible.length === 0) return false;
    const count = screen.getAllDisplays().length;
    if (count > 1 && this.visible.length === 1) {
      // Une seule page : elle change d'écran.
      this.visible = shiftPlacement(this.visible, this.visible[0]!.page, direction, count);
    } else this.visible = swapPlacements(this.visible, count, direction);
    this.relayout();
    return true;
  }

  close(id: PageId): void {
    if (id === "accueil") {
      // L'accueil ne se ferme pas : il redevient le fond.
      if (this.homeInLayout()) {
        this.visible = this.visible.filter((v) => v.page !== "accueil");
        this.relayout();
      }
      return;
    }
    if (!this.visible.some((v) => v.page === id) && !this.window(id)?.isVisible()) return;
    this.hide(id);
    this.relayout();
  }

  closeAll(): void {
    for (const id of this.open) if (id !== "accueil") this.hide(id);
    this.visible = [];
    this.relayout();
  }

  setGameRunning(running: boolean): void {
    if (this.game === running) return;
    this.game = running;
    this.relayout();
  }

  /** Recalcule les emplacements (après un changement d'écrans, par exemple). */
  relayout(): void {
    const spots = computeLayout({
      displays: this.displays(),
      visible: this.visible,
      home: this.homeInLayout() ? undefined : { page: "accueil", ecran: this.remembered.read().accueil ?? pageInfo("accueil").ecranParDefaut },
      gameRunning: this.game,
    });
    const byId = new Map(spots.map((s) => [s.page, s]));
    for (const [id, win] of this.windows) {
      const spot = byId.get(id);
      if (spot && !win.isDestroyed()) this.place(win, spot);
    }
  }

  broadcast(channel: string, payload: unknown, only?: PageId): void {
    for (const [id, win] of this.windows) {
      if (only && id !== only) continue;
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }

  private hide(id: PageId): void {
    this.visible = this.visible.filter((v) => v.page !== id);
    const win = this.window(id);
    if (id !== "accueil" && win?.isVisible()) {
      win.hide();
      this.options.onClose?.(id);
    }
  }

  private reveal(id: PageId, focus: boolean): void {
    const win = this.window(id);
    if (!win) return;
    const wasVisible = win.isVisible();
    // Pendant une partie, Jarvis ne passe jamais devant le jeu au clavier.
    if (focus && !this.game) {
      win.show();
      win.focus();
    } else win.showInactive();
    this.lastFocused = id;
    if (!wasVisible || id !== "accueil") this.options.onOpen?.(id);
  }

  /** Dernière page ouverte ou utilisée (celle que déplace un balayage). */
  get focusedPage(): PageId | undefined {
    const focused = [...this.windows.entries()].find(([, w]) => !w.isDestroyed() && w.isFocused())?.[0];
    return focused ?? this.lastFocused;
  }

  private ensureWindow(id: PageId): BrowserWindow {
    let win = this.window(id);
    if (win) return win;
    const single = screen.getAllDisplays().length === 1;
    win = new BrowserWindow({
      ...screen.getPrimaryDisplay().workArea,
      backgroundColor: "#020407",
      title: `JARVIS — ${pageInfo(id).titre}`,
      icon: this.options.icon,
      autoHideMenuBar: true,
      show: false,
      frame: single && id === "accueil",
      webPreferences: this.options.webPreferences,
    });
    void win.loadURL(this.options.url(id));
    win.on("close", (event) => {
      if (this.options.quitting()) return;
      // Fermer une page la cache seulement : la rouvrir est instantané.
      event.preventDefault();
      if (id === "accueil") win!.hide();
      else this.close(id);
    });
    win.on("focus", () => (this.lastFocused = id));
    win.on("closed", () => this.windows.delete(id));
    this.windows.set(id, win);
    return win;
  }

  private place(win: BrowserWindow, spot: WindowSpot): void {
    const target = screen.getAllDisplays().find((d) => d.id === spot.displayId);
    if (spot.fullscreen && target) {
      if (win.isFullScreen() && win.getBounds().x === target.bounds.x) return;
      if (win.isFullScreen()) win.setFullScreen(false);
      win.setBounds(target.bounds);
      win.setFullScreen(true);
      return;
    }
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    win.setBounds(spot.bounds);
  }
}
