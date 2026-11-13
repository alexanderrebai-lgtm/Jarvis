import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

/**
 * Spotify : connexion à ton compte (Premium) par une petite « appli
 * développeur » à toi, puis pilotage de l'appli Spotify du PC (Spotify Connect) :
 * lancer la playlist du réveil, monter le volume, mettre en pause, passer au titre suivant.
 * Connexion OAuth « PKCE » : aucun secret à stocker, seulement le jeton de rafraîchissement.
 */

export const SPOTIFY_SCOPES = ["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing", "playlist-read-private", "playlist-modify-private", "playlist-modify-public"];
export const SPOTIFY_REDIRECT_PORT = 8898;
export const SPOTIFY_REDIRECT = `http://127.0.0.1:${SPOTIFY_REDIRECT_PORT}/spotify`;

export interface SpotifyTokens {
  access: string;
  refresh: string;
  expiresAt: number;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number | null;
}

export interface SpotifyTrack {
  uri: string;
  name: string;
  artists: string;
}

type Fetch = typeof fetch;

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function authorizeUrl(clientId: string, challenge: string, state: string): string {
  const params = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: SPOTIFY_REDIRECT, code_challenge_method: "S256", code_challenge: challenge, state, scope: SPOTIFY_SCOPES.join(" ") });
  return `https://accounts.spotify.com/authorize?${params}`;
}

/** « https://open.spotify.com/playlist/37i9…?si=… » ou « spotify:playlist:37i9… » → URI Spotify. */
export function toSpotifyUri(link: string): string | undefined {
  const text = link.trim();
  if (/^spotify:(playlist|album|track|artist|show):[A-Za-z0-9]+$/.test(text)) return text;
  const m = text.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track|artist|show)\/([A-Za-z0-9]+)/);
  return m ? `spotify:${m[1]}:${m[2]}` : undefined;
}

/** Les refus de Spotify expliqués en français. */
export function explainSpotify(status: number, message: string): string {
  if (/premium/i.test(message) && /owner|app/i.test(message)) return "Spotify refuse : le compte qui a créé l'appli sur developer.spotify.com doit avoir un abonnement Premium actif. Crée l'appli avec ton compte Premium (pas un compte gratuit ou un membre d'un abonnement Famille qui n'est pas le titulaire), puis colle son nouveau Client ID dans les Réglages.";
  if (/premium/i.test(message)) return "Spotify demande un compte Premium pour piloter la lecture.";
  if (status === 403 && /user|allowlist|not registered|developer/i.test(message)) return "Spotify refuse : ton compte n'est pas autorisé sur l'appli. Sur developer.spotify.com → ton appli → Settings → User Management, ajoute ton nom et l'adresse e-mail de ton compte Spotify.";
  if (status === 401) return "La connexion à Spotify a expiré : clique à nouveau sur « Connecter Spotify ».";
  if (status === 404 && /device/i.test(message)) return "Aucun appareil Spotify actif : ouvre l'appli Spotify sur le PC.";
  if (status === 429) return "Spotify demande d'attendre un peu (trop de demandes).";
  return `Spotify : ${message} (erreur ${status})`;
}

export class SpotifyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class SpotifyClient {
  private readonly fetchFn: Fetch;

  constructor(
    private readonly options: {
      clientId: string | undefined;
      load: () => SpotifyTokens | undefined;
      save: (tokens: SpotifyTokens | undefined) => void;
      fetchFn?: Fetch;
      now?: () => number;
    },
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.options.clientId);
  }

  get connected(): boolean {
    return Boolean(this.options.clientId && this.options.load()?.refresh);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /**
   * Ouvre la page de connexion Spotify et attend le retour sur 127.0.0.1.
   * `open` ouvre l'adresse dans le navigateur d'Alex.
   */
  async connect(open: (url: string) => void, timeoutMs = 180_000): Promise<void> {
    const clientId = this.options.clientId;
    if (!clientId) throw new Error("Règle SPOTIFY_CLIENT_ID (ton appli sur developer.spotify.com).");
    const { verifier, challenge } = pkcePair();
    const state = base64url(randomBytes(12));
    const code = await new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", SPOTIFY_REDIRECT);
        if (url.pathname !== "/spotify") return void res.writeHead(404).end();
        const ok = url.searchParams.get("state") === state && url.searchParams.get("code");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<meta charset="utf-8"><body style="background:#020407;color:#cfefff;font:18px sans-serif;display:grid;place-items:center;height:90vh">${ok ? "Spotify est relié à Jarvis. Tu peux fermer cette page." : "La connexion a échoué. Réessaie depuis Jarvis."}</body>`);
        clearTimeout(timer);
        server.close();
        if (ok) resolve(url.searchParams.get("code")!);
        else reject(new Error(url.searchParams.get("error") ?? "connexion refusée"));
      });
      const timer = setTimeout(() => {
        server.close();
        reject(new Error("Pas de réponse de Spotify (délai dépassé)."));
      }, timeoutMs);
      server.on("error", reject);
      server.listen(SPOTIFY_REDIRECT_PORT, "127.0.0.1", () => open(authorizeUrl(clientId, challenge, state)));
    });
    await this.exchange({ grant_type: "authorization_code", code, redirect_uri: SPOTIFY_REDIRECT, code_verifier: verifier });
  }

  disconnect(): void {
    this.options.save(undefined);
  }

  private async exchange(body: Record<string, string>): Promise<SpotifyTokens> {
    const res = await this.fetchFn("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.options.clientId!, ...body }),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !data.access_token) {
      if (data.error === "invalid_grant") this.options.save(undefined);
      throw new SpotifyError(`Spotify refuse la connexion (${data.error ?? res.status}).`, res.status);
    }
    const tokens = { access: data.access_token, refresh: data.refresh_token ?? body.refresh_token ?? "", expiresAt: this.now() + (data.expires_in ?? 3600) * 1000 - 60_000 };
    this.options.save(tokens);
    return tokens;
  }

  private async accessToken(): Promise<string> {
    const tokens = this.options.load();
    if (!tokens?.refresh) throw new Error("Spotify n'est pas connecté. Dis « connecte Spotify ».");
    if (tokens.access && tokens.expiresAt > this.now()) return tokens.access;
    return (await this.exchange({ grant_type: "refresh_token", refresh_token: tokens.refresh })).access;
  }

  async api<T = unknown>(method: string, path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T | undefined> {
    const token = await this.accessToken();
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) params.set(k, String(v));
    const url = `https://api.spotify.com/v1${path}${params.size ? `?${params}` : ""}`;
    const res = await this.fetchFn(url, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (res.status === 204 || res.status === 202) return undefined;
    const text = await res.text();
    // Spotify répond parfois par une simple phrase au lieu de JSON (« Active premium subscription required… »).
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (!res.ok) {
      const message = (data as { error?: { message?: string } } | undefined)?.error?.message ?? (text.trim() || res.statusText);
      throw new SpotifyError(explainSpotify(res.status, message), res.status);
    }
    if (data === undefined && text.trim()) throw new SpotifyError(`Réponse inattendue de Spotify : ${text.trim().slice(0, 120)}`, res.status);
    return data as T;
  }

  async devices(): Promise<SpotifyDevice[]> {
    return (await this.api<{ devices: SpotifyDevice[] }>("GET", "/me/player/devices"))?.devices ?? [];
  }

  /** L'appareil de ce PC : l'appli Spotify (type « Computer »), lancée si besoin. */
  async ensureDevice(launch: () => Promise<void> | void, options: { timeoutMs?: number; preferName?: string; sleep?: (ms: number) => Promise<void> } = {}): Promise<SpotifyDevice | undefined> {
    const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const pick = (list: SpotifyDevice[]) =>
      list.find((d) => options.preferName && d.name.toLowerCase() === options.preferName.toLowerCase()) ?? list.find((d) => d.type === "Computer" && d.is_active) ?? list.find((d) => d.type === "Computer") ?? list.find((d) => d.is_active);
    let device = pick(await this.devices());
    if (device) return device;
    await launch();
    const deadline = this.now() + (options.timeoutMs ?? 20_000);
    while (this.now() < deadline) {
      await sleep(1500);
      device = pick(await this.devices().catch(() => []));
      if (device) return device;
    }
    return undefined;
  }

  async play(options: { deviceId?: string; contextUri?: string; uris?: string[] } = {}): Promise<void> {
    const body = options.contextUri ? { context_uri: options.contextUri } : options.uris ? { uris: options.uris } : undefined;
    await this.api("PUT", "/me/player/play", body, { device_id: options.deviceId });
  }

  async pause(deviceId?: string): Promise<void> {
    await this.api("PUT", "/me/player/pause", undefined, { device_id: deviceId });
  }

  async next(): Promise<void> {
    await this.api("POST", "/me/player/next");
  }

  async previous(): Promise<void> {
    await this.api("POST", "/me/player/previous");
  }

  async volume(percent: number, deviceId?: string): Promise<void> {
    await this.api("PUT", "/me/player/volume", undefined, { volume_percent: Math.round(Math.min(100, Math.max(0, percent))), device_id: deviceId });
  }

  async shuffle(on: boolean, deviceId?: string): Promise<void> {
    await this.api("PUT", "/me/player/shuffle", undefined, { state: on, device_id: deviceId });
  }

  async current(): Promise<{ playing: boolean; track?: SpotifyTrack; volume?: number; device?: string } | undefined> {
    const data = await this.api<{ is_playing: boolean; item?: { uri: string; name: string; artists?: Array<{ name: string }> }; device?: { volume_percent?: number; name?: string } }>("GET", "/me/player");
    if (!data) return undefined;
    return {
      playing: data.is_playing,
      ...(data.item ? { track: { uri: data.item.uri, name: data.item.name, artists: (data.item.artists ?? []).map((a) => a.name).join(", ") } } : {}),
      ...(data.device?.volume_percent !== undefined ? { volume: data.device.volume_percent } : {}),
      ...(data.device?.name ? { device: data.device.name } : {}),
    };
  }

  async search(query: string, limit = 5): Promise<SpotifyTrack[]> {
    const data = await this.api<{ tracks?: { items: Array<{ uri: string; name: string; artists: Array<{ name: string }> }> } }>("GET", "/search", undefined, { q: query, type: "track", limit, market: "FR" });
    return (data?.tracks?.items ?? []).map((t) => ({ uri: t.uri, name: t.name, artists: t.artists.map((a) => a.name).join(", ") }));
  }

  async searchPlaylist(query: string): Promise<{ uri: string; name: string } | undefined> {
    const data = await this.api<{ playlists?: { items: Array<{ uri: string; name: string } | null> } }>("GET", "/search", undefined, { q: query, type: "playlist", limit: 5, market: "FR" });
    return data?.playlists?.items.find((p): p is { uri: string; name: string } => Boolean(p));
  }

  async myPlaylists(): Promise<Array<{ id: string; uri: string; name: string }>> {
    const data = await this.api<{ items: Array<{ id: string; uri: string; name: string }> }>("GET", "/me/playlists", undefined, { limit: 50 });
    return data?.items ?? [];
  }

  /** Crée une playlist privée (nouvelle adresse /me/playlists, sinon l'ancienne). */
  async createPlaylist(name: string, description: string): Promise<{ id: string; uri: string }> {
    const body = { name, description, public: false };
    try {
      const created = await this.api<{ id: string; uri: string }>("POST", "/me/playlists", body);
      if (created?.id) return created;
    } catch (error) {
      if (!(error instanceof SpotifyError) || ![404, 405].includes(error.status)) throw error;
    }
    const me = await this.api<{ id: string }>("GET", "/me");
    const created = await this.api<{ id: string; uri: string }>("POST", `/users/${encodeURIComponent(me!.id)}/playlists`, body);
    return created!;
  }

  /** Ajoute des titres (nouvelle adresse /items, sinon /tracks). */
  async addToPlaylist(playlistId: string, uris: string[]): Promise<void> {
    if (!uris.length) return;
    try {
      await this.api("POST", `/playlists/${playlistId}/items`, { uris });
    } catch (error) {
      if (!(error instanceof SpotifyError) || ![404, 405].includes(error.status)) throw error;
      await this.api("POST", `/playlists/${playlistId}/tracks`, { uris });
    }
  }

  async removeFromPlaylist(playlistId: string, uris: string[]): Promise<void> {
    const body = { items: uris.map((uri) => ({ uri })), tracks: uris.map((uri) => ({ uri })) };
    try {
      await this.api("DELETE", `/playlists/${playlistId}/items`, body);
    } catch (error) {
      if (!(error instanceof SpotifyError) || ![404, 405].includes(error.status)) throw error;
      await this.api("DELETE", `/playlists/${playlistId}/tracks`, body);
    }
  }
}

/** Titres de départ de la playlist du réveil : doux au début, plus d'énergie ensuite (et un clin d'œil à Tony). */
export const WAKE_TRACKS = [
  "Here Comes The Sun The Beatles",
  "Lovely Day Bill Withers",
  "Sunday Morning Maroon 5",
  "Je veux Zaz",
  "Walking On Sunshine Katrina and the Waves",
  "Mr. Blue Sky Electric Light Orchestra",
  "Get Lucky Daft Punk",
  "Don't Stop Me Now Queen",
  "Happy Pharrell Williams",
  "Uptown Funk Mark Ronson Bruno Mars",
  "Shoot to Thrill AC/DC",
  "Back In Black AC/DC",
];
