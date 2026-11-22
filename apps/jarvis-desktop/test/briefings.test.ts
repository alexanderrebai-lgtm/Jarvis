import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BriefingStore, briefingDue, describeBriefing, parseHeure, toISODate, type Briefing } from "../src/main/briefings.js";

const base = (over: Partial<Briefing> = {}): Briefing => ({ id: "brief_1", sujet: "sim racing", heure: "08:00", jours: [], canaux: ["voix"], actif: true, creeLe: "2026-01-01T00:00:00Z", ...over });

describe("briefings : heure et horaire", () => {
  it("lit l'heure sous plusieurs formes", () => {
    expect(parseHeure("8:00")).toBe("08:00");
    expect(parseHeure("8h")).toBe("08:00");
    expect(parseHeure("18h30")).toBe("18:30");
    expect(parseHeure("25:00")).toBeUndefined();
    expect(parseHeure("abc")).toBeUndefined();
  });

  it("décide s'il faut lancer, attendre, ou rattraper tardivement", () => {
    // lundi 23 nov 2026, 8:05 → c'est l'heure
    const lundi805 = new Date(2026, 10, 23, 8, 5);
    expect(briefingDue(base(), lundi805)).toBe("lancer");
    // avant l'heure
    expect(briefingDue(base(), new Date(2026, 10, 23, 7, 59))).toBe("attendre");
    // déjà envoyé aujourd'hui
    expect(briefingDue(base({ dernierEnvoi: toISODate(lundi805) }), lundi805)).toBe("attendre");
    // mauvais jour (briefing seulement le mardi)
    expect(briefingDue(base({ jours: ["mar"] }), lundi805)).toBe("attendre");
    // bon jour
    expect(briefingDue(base({ jours: ["lun"] }), lundi805)).toBe("lancer");
    // longtemps après (soir) → rattrapage tardif, pas d'envoi la nuit
    expect(briefingDue(base(), new Date(2026, 10, 23, 22, 0))).toBe("rattrapage-tardif");
    // en pause
    expect(briefingDue(base({ actif: false }), lundi805)).toBe("attendre");
  });

  it("décrit un briefing en français", () => {
    expect(describeBriefing(base({ jours: ["lun"], heure: "08:00", canaux: ["telegram"] }))).toContain("lundi");
    expect(describeBriefing(base())).toContain("chaque jour");
  });
});

describe("briefings : magasin", () => {
  it("ajoute, met en pause, marque envoyé, supprime", () => {
    const store = new BriefingStore(mkdtempSync(path.join(tmpdir(), "brief-")));
    const b = store.add({ sujet: "  sim racing  ", heure: "7h30", jours: ["lun", "x" as never], canaux: ["telegram", "voix"] });
    expect(b).toMatchObject({ sujet: "sim racing", heure: "07:30", jours: ["lun"], canaux: ["telegram", "voix"], actif: true });
    expect(() => store.add({ sujet: "", heure: "08:00" })).toThrow(/sujet/);
    expect(() => store.add({ sujet: "x", heure: "99:99" })).toThrow(/heure/);
    store.setActive(b.id, false);
    expect(store.list()[0]!.actif).toBe(false);
    store.markSent(b.id, "2026-11-23");
    expect(store.list()[0]!.dernierEnvoi).toBe("2026-11-23");
    expect(store.remove(b.id)).toBe(true);
    expect(store.list()).toEqual([]);
  });
});
