import { describe, expect, it, vi } from "vitest";
import {
  SuiviVoiture,
  choisirPosition,
  etatVoiture,
  phraseVoiture,
  type TraccarDevice,
  type TraccarPosition,
} from "../src/main/voiture-suivi.js";

const dev: TraccarDevice = { id: 7, name: "Peugeot 107", status: "online", lastUpdate: "2026-11-22T12:00:00Z" };
const now = new Date("2026-11-22T12:05:00Z");

describe("voiture-suivi : état depuis Traccar", () => {
  it("convertit la vitesse (nœuds → km/h) et détecte le mouvement", () => {
    const pos: TraccarPosition = { deviceId: 7, latitude: 45.76, longitude: 4.84, speed: 27, fixTime: "2026-11-22T12:04:00Z", attributes: { motion: true, power: 12.6, odometer: 142000000 } };
    const e = etatVoiture(dev, pos, now);
    expect(e.enMouvement).toBe(true);
    expect(e.vitesseKmh).toBe(50); // 27 * 1.852 ≈ 50
    expect(e.tension).toBe(12.6);
    expect(e.km).toBe(142000); // 142 000 000 m → 142 000 km
    expect(e.enLigne).toBe(true);
  });

  it("voiture à l'arrêt et batterie faible", () => {
    const pos: TraccarPosition = { deviceId: 7, latitude: 45.76, longitude: 4.84, speed: 0, address: "12 rue de la Paix, Lyon", fixTime: "2026-11-22T12:00:00Z", attributes: { motion: false, power: 11.4 } };
    const e = etatVoiture(dev, pos, now);
    expect(e.enMouvement).toBe(false);
    const p = phraseVoiture(e);
    expect(p).toContain("à l'arrêt");
    expect(p).toContain("rue de la Paix");
    expect(p).toContain("faible");
  });

  it("choisit la position la plus récente pour l'appareil", () => {
    const positions: TraccarPosition[] = [
      { deviceId: 7, latitude: 1, longitude: 1, fixTime: "2026-11-22T10:00:00Z" },
      { deviceId: 7, latitude: 2, longitude: 2, fixTime: "2026-11-22T12:00:00Z" },
      { deviceId: 9, latitude: 3, longitude: 3, fixTime: "2026-11-22T13:00:00Z" },
    ];
    expect(choisirPosition(positions, 7)?.latitude).toBe(2);
  });

  it("signale un traceur hors ligne quand la position est vieille", () => {
    const vieux: TraccarDevice = { id: 7, name: "Peugeot 107", status: "offline" };
    const pos: TraccarPosition = { deviceId: 7, latitude: 45, longitude: 4, speed: 0, fixTime: "2026-11-22T09:00:00Z", attributes: {} };
    expect(etatVoiture(vieux, pos, now).enLigne).toBe(false);
    expect(phraseVoiture(etatVoiture(vieux, pos, now))).toContain("hors ligne");
  });
});

describe("voiture-suivi : client Traccar (fetch simulé)", () => {
  const mockFetch = (devices: unknown, positions: unknown): typeof fetch =>
    vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      const body = u.includes("/api/devices") ? devices : positions;
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as unknown as typeof fetch;

  it("lit l'état de la voiture suivie", async () => {
    const suivi = new SuiviVoiture({
      url: "http://192.168.1.50:8082/",
      token: "abc",
      appareil: "107",
      fetch: mockFetch([dev], [{ deviceId: 7, latitude: 45.76, longitude: 4.84, speed: 0, fixTime: "2026-11-22T12:03:00Z", attributes: { motion: false } }]),
    });
    const e = await suivi.etat(now);
    expect(e.nom).toBe("Peugeot 107");
    expect(e.enMouvement).toBe(false);
  });

  it("explique gentiment un refus d'authentification", async () => {
    const suivi = new SuiviVoiture({
      url: "http://x:8082",
      token: "mauvais",
      fetch: vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }) as Response) as unknown as typeof fetch,
    });
    expect(await suivi.phrase(now)).toContain("refusés");
  });
});
