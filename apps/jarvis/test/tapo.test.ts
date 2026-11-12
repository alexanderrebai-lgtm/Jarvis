import { describe, expect, it } from "vitest";
import { decodeAlias, parseDeviceList, TapoHome, type TapoConnection, type TapoDriver, type TapoEntry } from "../src/tapo.js";

function fakeDriver(entries: TapoEntry[], options: { failOnce?: string; offline?: string } = {}) {
  const log: string[] = [];
  const state = new Map(entries.map((e) => [e.nom, { on: false, brightness: 50 }]));
  let failed = false;
  const driver: TapoDriver = {
    discover: async () => entries,
    connect: async (entry) => {
      if (entry.nom === options.offline) throw new Error("délai dépassé");
      log.push(`connexion ${entry.nom}`);
      const s = state.get(entry.nom)!;
      const device: TapoConnection = {
        turnOn: async () => {
          if (entry.nom === options.failOnce && !failed) {
            failed = true;
            throw new Error("session expirée");
          }
          s.on = true;
          log.push(`on ${entry.nom}`);
        },
        turnOff: async () => {
          s.on = false;
          log.push(`off ${entry.nom}`);
        },
        setBrightness: async (level) => {
          s.brightness = level;
          log.push(`lum ${entry.nom} ${level}`);
        },
        setColour: async (colour) => void log.push(`couleur ${entry.nom} ${colour}`),
        getDeviceInfo: async () => ({ device_on: s.on, brightness: s.brightness, model: entry.modele, type: entry.type === "prise" ? "SMART.TAPOPLUG" : "SMART.TAPOBULB" }),
        getEnergyUsage: async () => ({ today_energy: 120, current_power: 4500 }),
      };
      return device;
    },
  };
  return { driver, log, state };
}

const DEVICES: TapoEntry[] = [
  { nom: "Lampe salon", type: "ampoule", modele: "L530" },
  { nom: "Lampe chambre", type: "ampoule", modele: "L510" },
  { nom: "Prise télé", type: "prise", modele: "P110" },
];

describe("Tapo", () => {
  it("allume une lampe par son nom, accents et majuscules ignorés", async () => {
    const { driver, log } = fakeDriver(DEVICES);
    const home = new TapoHome(driver);
    expect(await home.command("SALON", { action: "allumer" })).toEqual([{ nom: "Lampe salon", ok: true }]);
    expect(await home.command("prise tele", { action: "eteindre" })).toEqual([{ nom: "Prise télé", ok: true }]);
    expect(log).toEqual(["connexion Lampe salon", "on Lampe salon", "connexion Prise télé", "off Prise télé"]);
  });

  it("gère les groupes et la luminosité (qui allume l'ampoule)", async () => {
    const { driver, state } = fakeDriver(DEVICES);
    const home = new TapoHome(driver);
    const result = await home.command("toutes les lumières", { luminosite: 30 });
    expect(result.map((r) => r.nom)).toEqual(["Lampe salon", "Lampe chambre"]);
    expect(state.get("Lampe chambre")).toEqual({ on: true, brightness: 30 });
    expect(state.get("Prise télé")!.on).toBe(false);
    expect((await home.command("tout", { action: "eteindre" })).every((r) => r.ok)).toBe(true);
    const plug = await home.command("prise", { couleur: "red" });
    expect(plug[0]).toMatchObject({ ok: false, erreur: expect.stringMatching(/prise/) });
  });

  it("donne l'état et la consommation, même si un appareil est débranché", async () => {
    const { driver } = fakeDriver(DEVICES, { offline: "Lampe chambre" });
    const home = new TapoHome(driver);
    await home.command("salon", { action: "allumer" });
    const states = await home.states(true);
    expect(states[0]).toMatchObject({ nom: "Lampe salon", allume: true, luminosite: 50 });
    expect(states[1]).toMatchObject({ nom: "Lampe chambre", allume: null, erreur: expect.stringMatching(/injoignable/) });
    expect(states[2]).toMatchObject({ nom: "Prise télé", allume: false, consommationAujourdhuiWh: 120, puissanceW: 4.5 });
  });

  it("se reconnecte une fois quand la session a expiré", async () => {
    const { driver, log } = fakeDriver(DEVICES, { failOnce: "Lampe salon" });
    const home = new TapoHome(driver);
    expect(await home.command("salon", { action: "allumer" })).toEqual([{ nom: "Lampe salon", ok: true }]);
    expect(log.filter((l) => l.startsWith("connexion"))).toHaveLength(2);
  });

  it("explique quand aucun appareil ne correspond", async () => {
    const home = new TapoHome(fakeDriver(DEVICES).driver);
    await expect(home.command("cuisine", { action: "allumer" })).rejects.toThrow(/Lampe salon, Lampe chambre, Prise télé/);
  });

  it("devine le type des appareils listés à la main", async () => {
    const manual = parseDeviceList("Lampe bureau=192.168.1.20,Prise frigo=192.168.1.21");
    const { driver } = fakeDriver([
      { ...manual[0]!, modele: "L530" },
      { ...manual[1]!, modele: "P110" },
    ]);
    // Le faux appareil renvoie son type d'après « type » de l'entrée : on simule la réponse réelle.
    const original = driver.connect;
    driver.connect = async (entry) => {
      const device = await original(entry);
      return { ...device, getDeviceInfo: async () => ({ device_on: false, model: entry.modele, type: entry.modele.startsWith("P") ? "SMART.TAPOPLUG" : "SMART.TAPOBULB" }) };
    };
    const home = new TapoHome(driver);
    expect((await home.match("toutes les prises")).map((d) => d.nom)).toEqual(["Prise frigo"]);
    expect((await home.match("toutes les lumières")).map((d) => d.nom)).toEqual(["Lampe bureau"]);
  });

  it("lit la liste manuelle et décode les noms TP-Link", () => {
    expect(parseDeviceList("Salon=192.168.1.20, Bureau = 192.168.1.21")).toEqual([
      { nom: "Salon", ip: "192.168.1.20", type: "autre", modele: "" },
      { nom: "Bureau", ip: "192.168.1.21", type: "autre", modele: "" },
    ]);
    expect(() => parseDeviceList("Salon")).toThrow(/Nom=IP/);
    expect(decodeAlias(Buffer.from("Lampe chambre").toString("base64"))).toBe("Lampe chambre");
    expect(decodeAlias("Lamp")).toBe("Lamp");
  });
});
