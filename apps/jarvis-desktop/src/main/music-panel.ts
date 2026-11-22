import type { NowPlaying, SpotifyClient } from "./reveil/spotify.js";

/**
 * Module Musique de l'accueil : titre en cours, pochette, progression,
 * commandes. Un raté réseau passager ne vide pas le module : le dernier titre
 * reste affiché et l'erreur n'apparaît qu'après trois échecs de suite.
 */

export type MusicState = NowPlaying & { relie: boolean; erreur?: string };
export type MusicAction = "lecture" | "pause" | "suivant" | "precedent" | "volume";

export class MusicPanel {
  private state: MusicState = { actif: false, relie: false };
  private failures = 0;

  constructor(
    private readonly options: {
      spotify: SpotifyClient;
      /** Lecture et commandes par l'appli Spotify quand l'API ne suffit pas. */
      helpers: { play: (query?: string) => Promise<unknown>; control: (action: "pause" | "suivant" | "precedent") => Promise<unknown> };
      device: () => string | undefined;
      publish: (state: MusicState) => void;
    },
  ) {}

  get current(): MusicState {
    return this.state;
  }

  async refresh(): Promise<MusicState> {
    const { spotify } = this.options;
    if (!spotify.connected) this.state = { actif: false, relie: false };
    else {
      try {
        this.state = { ...(await spotify.nowPlaying()), relie: true };
        this.failures = 0;
      } catch (error) {
        this.failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        if (this.failures >= 3 || !this.state.relie) this.state = { actif: false, relie: true, erreur: message };
      }
    }
    this.options.publish(this.state);
    return this.state;
  }

  async command(payload: { action: MusicAction; valeur?: number }): Promise<MusicState> {
    const { spotify, helpers } = this.options;
    const device = this.options.device();
    try {
      if (payload.action === "lecture") await spotify.play({ ...(device ? { deviceId: device } : {}) }).catch(async () => helpers.play());
      else if (payload.action === "volume") await spotify.volume(payload.valeur ?? 50, device);
      else await helpers.control(payload.action);
    } catch (error) {
      this.state = { ...this.state, erreur: error instanceof Error ? error.message : String(error) };
    }
    await new Promise((r) => setTimeout(r, 350));
    return this.refresh();
  }
}
