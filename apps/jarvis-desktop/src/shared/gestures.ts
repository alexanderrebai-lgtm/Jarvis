/**
 * Gestes de la main ouverte : la tenir immobile = « stop » ; la balayer vers la
 * gauche ou la droite = changer les pages d'écran. Les positions viennent de la
 * webcam (0 à 1, image non retournée : quand Alex bouge la main vers sa droite,
 * elle part vers la gauche de l'image).
 */

export type PalmEvent = "stop" | "balayage-gauche" | "balayage-droite";

interface Sample {
  x: number;
  y: number;
  t: number;
}

export interface PalmTrackerOptions {
  /** Distance horizontale minimale d'un balayage (fraction de la largeur). */
  swipeDistance?: number;
  /** Durée maximale d'un balayage (ms). */
  swipeMs?: number;
  /** Durée d'immobilité pour « stop » (ms). */
  holdMs?: number;
  /** Déplacement maximal toléré pendant l'immobilité. */
  holdTolerance?: number;
  /** Délai entre deux événements (ms). */
  cooldownMs?: number;
  /** Vrai si l'image de la caméra est en miroir (la droite d'Alex est à droite de l'image). */
  mirrored?: boolean;
}

export class PalmTracker {
  private samples: Sample[] = [];
  private lastEventAt = -Infinity;
  private holdFired = false;

  constructor(private readonly options: PalmTrackerOptions = {}) {}

  /** Une image analysée : main ouverte (avec la position du poignet) ou non. */
  push(open: boolean, x: number, y: number, t: number): PalmEvent | undefined {
    if (!open) {
      this.samples = [];
      this.holdFired = false;
      return undefined;
    }
    const swipeMs = this.options.swipeMs ?? 800;
    const holdMs = this.options.holdMs ?? 650;
    this.samples.push({ x, y, t });
    const horizon = Math.max(swipeMs, holdMs) + 200;
    while (this.samples.length && t - this.samples[0]!.t > horizon) this.samples.shift();
    if (t - this.lastEventAt < (this.options.cooldownMs ?? 1200)) return undefined;

    // Balayage : grand déplacement horizontal, rapide, plutôt à plat.
    const recent = this.samples.filter((s) => t - s.t <= swipeMs);
    if (recent.length >= 3) {
      const first = recent[0]!;
      const dx = x - first.x;
      const dy = y - first.y;
      if (Math.abs(dx) >= (this.options.swipeDistance ?? 0.22) && Math.abs(dy) < Math.abs(dx) * 0.6) {
        this.lastEventAt = t;
        this.samples = [];
        this.holdFired = true; // pas de « stop » juste après un balayage
        const towardImageLeft = dx < 0;
        const userRight = this.options.mirrored ? !towardImageLeft : towardImageLeft;
        return userRight ? "balayage-droite" : "balayage-gauche";
      }
    }

    // Main tenue immobile : « stop », une seule fois par geste.
    if (!this.holdFired) {
      const held = this.samples.filter((s) => t - s.t <= holdMs);
      if (held.length >= 4 && t - held[0]!.t >= holdMs * 0.85) {
        const xs = held.map((s) => s.x);
        const ys = held.map((s) => s.y);
        const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        if (spread <= (this.options.holdTolerance ?? 0.06)) {
          this.holdFired = true;
          this.lastEventAt = t;
          return "stop";
        }
      }
    }
    return undefined;
  }
}
