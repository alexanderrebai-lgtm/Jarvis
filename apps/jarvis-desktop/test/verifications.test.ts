import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VerifStore, lancerVerifications, phraseVerifications, resume, type CheckDef } from "../src/main/verifications.js";

const def = (id: string, lancer: CheckDef["lancer"]): CheckDef => ({ id, titre: `Titre ${id}`, lancer });

describe("test de bout en bout", () => {
  it("lance chaque vérification, rend le verdict et la durée", async () => {
    const r = await lancerVerifications([def("a", async () => ({ etat: "ok", detail: "ça marche" })), def("b", async () => ({ etat: "ignore", detail: "Pas configuré." }))], { now: () => new Date("2026-11-22T12:00:00Z") });
    expect(r.map((v) => [v.id, v.etat])).toEqual([["a", "ok"], ["b", "ignore"]]);
    expect(r[0]!.le).toBe("2026-11-22T12:00:00.000Z");
    expect(r[0]!.ms).toBeGreaterThanOrEqual(0);
  });

  it("une vérification qui plante ou qui ne répond pas devient un échec lisible, sans bloquer les autres", async () => {
    const r = await lancerVerifications(
      [def("plante", async () => { throw new Error("connexion refusée"); }), def("lente", () => new Promise(() => undefined)), def("ok", async () => ({ etat: "ok", detail: "bon" }))],
      { delaiMs: 80 },
    );
    expect(r[0]).toMatchObject({ etat: "echec", detail: "connexion refusée" });
    expect(r[1]).toMatchObject({ etat: "echec" });
    expect(r[1]!.detail).toContain("Pas de réponse");
    expect(r[1]!.conseil).toBeTruthy();
    expect(r[2]!.etat).toBe("ok");
  });

  it("les vérifications se font l'une après l'autre", async () => {
    const ordre: string[] = [];
    await lancerVerifications(["x", "y", "z"].map((id) => def(id, async () => (ordre.push(`début ${id}`), await new Promise((r) => setTimeout(r, 15)), ordre.push(`fin ${id}`), { etat: "ok", detail: "" }))));
    expect(ordre).toEqual(["début x", "fin x", "début y", "fin y", "début z", "fin z"]);
  });

  it("résume et dit ce qui ne va pas", async () => {
    const r = await lancerVerifications([def("a", async () => ({ etat: "ok", detail: "" })), def("b", async () => ({ etat: "echec", detail: "caméra muette" })), def("c", async () => ({ etat: "attention", detail: "1 ampoule injoignable" })), def("d", async () => ({ etat: "ignore", detail: "" }))]);
    expect(resume(r)).toEqual({ ok: 1, attention: 1, echec: 1, ignore: 1 });
    const p = phraseVerifications(r);
    expect(p).toContain("1 en échec");
    expect(p).toContain("caméra muette");
    expect(p).toContain("1 ampoule injoignable");
    expect(phraseVerifications([])).toContain("pas encore fait");
  });

  it("mémorise le dernier résultat de chaque fonction ; un test isolé n'efface pas les autres", async () => {
    const store = new VerifStore(mkdtempSync(path.join(tmpdir(), "verif-")));
    store.save(await lancerVerifications([def("a", async () => ({ etat: "ok", detail: "1" })), def("b", async () => ({ etat: "echec", detail: "2" }))]));
    store.save(await lancerVerifications([def("b", async () => ({ etat: "ok", detail: "réparé" }))]));
    expect(store.all().a!.detail).toBe("1");
    expect(store.all().b).toMatchObject({ etat: "ok", detail: "réparé" });
    expect(store.list()).toHaveLength(2);
  });
});
