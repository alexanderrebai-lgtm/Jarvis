/**
 * Maison connectée via Home Assistant (https://www.home-assistant.io), qui relie
 * plus de 2 000 marques : Philips Hue, Xiaomi, Tuya / Smart Life, Google Nest,
 * Netatmo, Somfy, Sonos, Shelly, aspirateurs robots, prises, thermostats…
 * Jarvis utilise son API officielle avec un jeton d'accès longue durée.
 */

export interface DeviceState {
  entite: string;
  nom: string;
  etat: string;
  unite?: string;
  piece?: string;
  details?: Record<string, unknown>;
}

/** Domaines que Jarvis a le droit de piloter. Le reste (réglages système…) est en lecture seule. */
export const CONTROLLABLE_DOMAINS = new Set([
  "light",
  "switch",
  "fan",
  "climate",
  "cover",
  "media_player",
  "scene",
  "script",
  "vacuum",
  "input_boolean",
  "humidifier",
  "water_heater",
  "button",
  "lock",
  "alarm_control_panel",
]);

/** Actions qui touchent à la sécurité du logement : accord explicite obligatoire. */
export function isSensitive(domain: string, service: string, entityId: string): boolean {
  if (domain === "lock" && service !== "lock") return true;
  if (domain === "alarm_control_panel" && service.startsWith("alarm_disarm")) return true;
  if (domain === "cover" && /garage|portail|gate/i.test(entityId) && service !== "close_cover") return true;
  return false;
}

const USEFUL_ATTRIBUTES = [
  "brightness",
  "color_mode",
  "current_temperature",
  "temperature",
  "hvac_action",
  "current_position",
  "battery_level",
  "media_title",
  "volume_level",
  "source",
];

interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export class HomeAssistant {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async request<T>(path: string, init?: { method: string; body: unknown }): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      ...(init ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401) throw new Error("Home Assistant refuse le jeton (HOME_ASSISTANT_TOKEN).");
    if (!response.ok) throw new Error(`Home Assistant a répondu ${response.status} : ${(await response.text()).slice(0, 200)}`);
    return (await response.json()) as T;
  }

  /** États des appareils, filtrés par mot-clé (nom, pièce, identifiant) et/ou type. */
  async states(query?: string, domain?: string, limit = 60): Promise<DeviceState[]> {
    const all = await this.request<HaState[]>("/api/states");
    const words = query ? normalize(query).split(/\s+/).filter(Boolean) : [];
    return all
      .filter((s) => {
        const entityDomain = s.entity_id.split(".")[0]!;
        if (domain && entityDomain !== domain) return false;
        if (!domain && !CONTROLLABLE_DOMAINS.has(entityDomain) && entityDomain !== "sensor" && entityDomain !== "binary_sensor") return false;
        const haystack = normalize(`${s.entity_id} ${String(s.attributes.friendly_name ?? "")} ${String(s.attributes.area ?? "")}`);
        return words.every((w) => haystack.includes(w));
      })
      .slice(0, limit)
      .map((s) => {
        const details = Object.fromEntries(USEFUL_ATTRIBUTES.filter((k) => s.attributes[k] !== undefined).map((k) => [k, s.attributes[k]]));
        return {
          entite: s.entity_id,
          nom: String(s.attributes.friendly_name ?? s.entity_id),
          etat: s.state,
          ...(s.attributes.unit_of_measurement ? { unite: String(s.attributes.unit_of_measurement) } : {}),
          ...(Object.keys(details).length ? { details } : {}),
        };
      });
  }

  /** Lance une action Home Assistant (ex. light.turn_on) sur un appareil. */
  async command(
    entityId: string,
    service: string,
    data: Record<string, unknown> = {},
    userConfirmed = false,
  ): Promise<{ ok: true; changes: DeviceState[] }> {
    const domain = entityId.split(".")[0] ?? "";
    if (!/^[a-z_]+\.[a-z0-9_]+$/.test(entityId)) throw new Error(`Identifiant d'appareil invalide : ${entityId}`);
    if (!/^[a-z_]+$/.test(service)) throw new Error(`Action invalide : ${service}`);
    if (!CONTROLLABLE_DOMAINS.has(domain)) throw new Error(`Les appareils de type « ${domain} » sont en lecture seule.`);
    if (isSensitive(domain, service, entityId) && !userConfirmed) {
      throw new Error(
        "Action de sécurité (serrure, alarme, portail ou garage) : demande d'abord un « oui » explicite à l'utilisateur, puis rappelle l'outil avec confirmation_utilisateur=true.",
      );
    }
    const changed = await this.request<HaState[]>(`/api/services/${domain}/${service}`, {
      method: "POST",
      body: { ...data, entity_id: entityId },
    });
    return {
      ok: true,
      changes: (Array.isArray(changed) ? changed : []).map((s) => ({
        entite: s.entity_id,
        nom: String(s.attributes.friendly_name ?? s.entity_id),
        etat: s.state,
      })),
    };
  }
}
