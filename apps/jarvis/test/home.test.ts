import { describe, expect, it } from "vitest";
import { HomeAssistant, isSensitive } from "../src/home.js";

const STATES = [
  { entity_id: "light.salon", state: "off", attributes: { friendly_name: "Lumière Salon" } },
  { entity_id: "climate.chambre", state: "heat", attributes: { friendly_name: "Radiateur Chambre", current_temperature: 18.5, temperature: 19 } },
  { entity_id: "sensor.temperature_exterieure", state: "7.2", attributes: { friendly_name: "Température extérieure", unit_of_measurement: "°C" } },
  { entity_id: "lock.porte_entree", state: "locked", attributes: { friendly_name: "Porte d'entrée" } },
  { entity_id: "update.home_assistant", state: "off", attributes: { friendly_name: "Mise à jour" } },
];

function fakeHa() {
  const calls: Array<{ url: string; body: unknown; auth: string | null }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init.headers).get("authorization") });
    if (url.endsWith("/api/states")) return new Response(JSON.stringify(STATES));
    return new Response(JSON.stringify([{ ...STATES[0], state: "on" }]));
  }) as unknown as typeof fetch;
  return { ha: new HomeAssistant("http://maison.local:8123/", "jeton", fetchImpl), calls };
}

describe("Home Assistant", () => {
  it("liste les appareils utiles, filtrés sans accents", async () => {
    const { ha, calls } = fakeHa();
    const all = await ha.states();
    expect(all.map((d) => d.entite)).not.toContain("update.home_assistant");
    expect(await ha.states("temperature exterieure")).toEqual([
      { entite: "sensor.temperature_exterieure", nom: "Température extérieure", etat: "7.2", unite: "°C" },
    ]);
    expect((await ha.states(undefined, "climate"))[0]!.details).toEqual({ current_temperature: 18.5, temperature: 19 });
    expect(calls[0]).toMatchObject({ url: "http://maison.local:8123/api/states", auth: "Bearer jeton" });
  });

  it("pilote une lumière et transmet les paramètres", async () => {
    const { ha, calls } = fakeHa();
    const result = await ha.command("light.salon", "turn_on", { brightness_pct: 40 });
    expect(result.changes[0]).toMatchObject({ entite: "light.salon", etat: "on" });
    expect(calls[0]).toMatchObject({
      url: "http://maison.local:8123/api/services/light/turn_on",
      body: { brightness_pct: 40, entity_id: "light.salon" },
    });
  });

  it("exige un accord pour la sécurité et refuse le reste", async () => {
    const { ha, calls } = fakeHa();
    await expect(ha.command("lock.porte_entree", "unlock")).rejects.toThrow(/sécurité/);
    await ha.command("lock.porte_entree", "lock");
    await ha.command("lock.porte_entree", "unlock", {}, true);
    await expect(ha.command("update.home_assistant", "install")).rejects.toThrow(/lecture seule/);
    await expect(ha.command("light.salon/../x", "turn_on")).rejects.toThrow(/invalide/);
    expect(calls).toHaveLength(2);
    expect(isSensitive("alarm_control_panel", "alarm_disarm", "alarm_control_panel.maison")).toBe(true);
    expect(isSensitive("cover", "open_cover", "cover.porte_garage")).toBe(true);
    expect(isSensitive("cover", "open_cover", "cover.volet_salon")).toBe(false);
  });
});
