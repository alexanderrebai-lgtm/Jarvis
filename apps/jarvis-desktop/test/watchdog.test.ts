import { describe, expect, it } from "vitest";
import type { CheckResult } from "../src/main/diagnostic.js";
import { openSecrets, sealSecrets, mergeEnvText } from "../src/main/secret-backup.js";
import { explainGoogle } from "../src/main/settings.js";
import { describeLost, Watchdog } from "../src/main/watchdog.js";

const r = (id: string, etat: CheckResult["etat"]): CheckResult => ({ id, groupe: "g", titre: id, etat, detail: etat });

describe("veilleur des connexions", () => {
  it("prévient une seule fois après deux échecs, puis au retour", async () => {
    let states: CheckResult[] = [];
    const lost: string[][] = [];
    const back: string[][] = [];
    const w = new Watchdog({ run: async () => states, watched: ["google", "tapo", "spotify"], onLost: (l) => lost.push(l.map((x) => x.id)), onBack: (b) => back.push(b.map((x) => x.id)) });
    states = [r("google", "ok"), r("tapo", "ok"), r("spotify", "absent"), r("autre", "erreur")];
    await w.check();
    states = [r("google", "erreur"), r("tapo", "ok"), r("spotify", "absent")];
    await w.check();
    expect(lost).toEqual([]); // un seul échec : peut-être passager
    await w.check();
    expect(lost).toEqual([["google"]]);
    await w.check();
    expect(lost).toHaveLength(1); // pas de répétition
    states = [r("google", "ok"), r("tapo", "ok"), r("spotify", "absent")];
    await w.check();
    expect(back).toEqual([["google"]]);
    expect(w.down.size).toBe(0);
  });

  it("un échec isolé ne déclenche rien", async () => {
    let n = 0;
    const lost: unknown[] = [];
    const w = new Watchdog({ run: async () => [r("tapo", n++ % 2 ? "attention" : "ok")], watched: ["tapo"], onLost: (l) => lost.push(l), onBack: () => undefined });
    for (let i = 0; i < 6; i++) await w.check();
    expect(lost).toEqual([]);
  });

  it("décrit ce qui a décroché", () => {
    expect(describeLost([{ ...r("google", "erreur"), titre: "Gmail", detail: "expiré", conseil: "reconnecte" }])).toBe("• Gmail : expiré → reconnecte");
  });
});

describe("copie portable des mots de passe", () => {
  const bundle = { version: 1 as const, date: "2026-11-21T10:00:00Z", coffre: { GOOGLE_REFRESH_TOKEN: "1//secret", TAPO_PASSWORD: "mdp" }, reglages: "TAPO_EMAIL=a@b.fr\n" };

  it("se relit avec le bon mot de passe, pas avec un autre", () => {
    const sealed = sealSecrets(bundle, "correct horse");
    expect(sealed.toString("latin1")).not.toContain("1//secret");
    expect(openSecrets(sealed, "correct horse")).toEqual(bundle);
    expect(() => openSecrets(sealed, "mauvais mdp")).toThrow(/incorrect/);
    expect(() => openSecrets(Buffer.from("n'importe quoi"), "correct horse")).toThrow(/pas une sauvegarde/);
    expect(() => sealSecrets(bundle, "court")).toThrow(/8 caractères/);
  });

  it("fusionne les réglages sans écraser par du vide", () => {
    expect(mergeEnvText({ A: "1", B: "2" }, { A: "1", B: "3", C: "", D: "4" })).toEqual({ B: "3", D: "4" });
  });
});

describe("erreurs Google", () => {
  it("explique l'expiration du mode test", () => {
    expect(explainGoogle("invalid_grant: Token has been expired or revoked.")).toContain("7 jours");
    expect(explainGoogle("invalid_client")).toContain("ID client");
  });
});
