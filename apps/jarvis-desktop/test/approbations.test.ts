import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Brain, type QueryFn } from "../src/main/brain.js";
import { Approbations, SENSIBLES, exigeApprobation, modeApprobation, type Demande } from "../src/main/approbations.js";

describe("approbation : qui doit demander ?", () => {
  it("par défaut, jamais ; « taches » seulement pour les tâches de fond ; « tout » pour toute action sensible", () => {
    expect(modeApprobation(undefined)).toBe("off");
    expect(modeApprobation("n'importe quoi")).toBe("off");
    expect(exigeApprobation("off", "pc_powershell", "tâche de fond")).toBe(false);
    expect(exigeApprobation("taches", "pc_powershell", "tâche de fond")).toBe(true);
    expect(exigeApprobation("taches", "pc_powershell", "conversation")).toBe(false); // Alex est devant le PC
    expect(exigeApprobation("tout", "pc_powershell", "conversation")).toBe(true);
    expect(exigeApprobation("tout", "meteo", "tâche de fond")).toBe(false); // outil sans risque
    for (const risque of ["Bash", "PowerShell", "pc_clavier", "pc_souris", "fichier_corbeille", "sauvegarde_restaurer", "tache_lancer"]) expect(SENSIBLES.has(risque), risque).toBe(true);
  });
});

describe("approbation : le courtier", () => {
  const nouveau = (delaiMs = 5_000) => {
    const notifiees: Demande[] = [];
    const jour: Demande[] = [];
    const a = new Approbations({ delaiMs, notifier: (d) => notifiees.push(d), journaliser: (d) => jour.push(d) });
    return { a, notifiees, jour };
  };

  it("approuvée : l'action peut se faire, et la décision est journalisée", async () => {
    const { a, notifiees, jour } = nouveau();
    const p = a.demander("pc_powershell", "Get-Process", "tâche de fond");
    expect(notifiees).toHaveLength(1);
    expect(a.enAttente()).toHaveLength(1);
    expect(a.repondre(notifiees[0]!.id, true)).toBe(true);
    expect(await p).toBe(true);
    expect(a.enAttente()).toHaveLength(0);
    expect(jour[0]).toMatchObject({ etat: "approuvee", outil: "pc_powershell" });
  });

  it("refusée : l'action n'a pas lieu", async () => {
    const { a, notifiees } = nouveau();
    const p = a.demander("fichier_corbeille", "C:\\vieux", "téléphone");
    a.repondre(notifiees[0]!.id, false);
    expect(await p).toBe(false);
    expect(a.recentes()[0]!.etat).toBe("refusee");
  });

  it("SANS RÉPONSE, C'EST REFUSÉ", async () => {
    const { a, jour } = nouveau(30);
    expect(await a.demander("pc_clavier", "taper un texte", "tâche de fond")).toBe(false);
    expect(jour[0]!.etat).toBe("expiree");
    expect(a.enAttente()).toHaveLength(0);
  });

  it("une réponse tardive ou en double ne change rien, un identifiant inconnu non plus", async () => {
    const { a, notifiees } = nouveau(40);
    const p = a.demander("pc_souris", "clic", "tâche de fond");
    await p;
    expect(a.repondre(notifiees[0]!.id, true)).toBe(false); // expirée : trop tard
    expect(a.repondre("inconnu", true)).toBe(false);
    const { a: b, notifiees: n2 } = nouveau();
    const q = b.demander("pc_souris", "clic", "x");
    expect(b.repondre(n2[0]!.id, false)).toBe(true);
    expect(b.repondre(n2[0]!.id, true)).toBe(false); // pas de revirement
    expect(await q).toBe(false);
  });

  it("plusieurs demandes en parallèle sont indépendantes", async () => {
    const { a, notifiees } = nouveau();
    const p1 = a.demander("Bash", "ls", "tâche de fond");
    const p2 = a.demander("PowerShell", "dir", "tâche de fond");
    a.repondre(notifiees[1]!.id, true);
    a.repondre(notifiees[0]!.id, false);
    expect([await p1, await p2]).toEqual([false, true]);
  });
});

describe("approbation : branchée au cerveau", () => {
  /** Récupère le garde (canUseTool) que le cerveau donne à Claude Code, comme le ferait le vrai moteur. */
  async function garde(approuver: NonNullable<ConstructorParameters<typeof Brain>[0]["approuver"]>, source?: string) {
    let canUse: ((nom: string, input: Record<string, unknown>) => Promise<{ behavior: string; message?: string }>) | undefined;
    const fn = ((p: { options: { canUseTool: typeof canUse } }) => {
      canUse = p.options.canUseTool;
      return (async function* () {
        yield { type: "result", subtype: "success", result: "ok" };
      })();
    }) as unknown as QueryFn;
    const b = new Brain({ dataDir: mkdtempSync(path.join(tmpdir(), "ap-")), workspace: "C:\\J", systemPrompt: "p", mcpServers: {}, queryFn: fn, approuver });
    await b.ask("salut", {}, source ? { source, separate: true } : {});
    return canUse!;
  }

  it("refuse l'outil quand Alex n'approuve pas, et l'autorise quand il approuve", async () => {
    const vus: string[] = [];
    const non = await garde(async (outil) => (vus.push(outil), { ok: false, raison: "Refusé : pas d'accord." }), "tâche de fond");
    expect(await non("mcp__jarvis__pc_powershell", { script: "dir" })).toMatchObject({ behavior: "deny", message: "Refusé : pas d'accord." });
    expect(vus).toEqual(["mcp__jarvis__pc_powershell"]);
    const oui = await garde(async () => ({ ok: true }), "tâche de fond");
    expect(await oui("mcp__jarvis__pc_powershell", { script: "dir" })).toMatchObject({ behavior: "allow" });
  });

  it("n'est consulté qu'après la politique : une action interdite reste interdite sans même demander", async () => {
    let demande = false;
    const g = await garde(async () => ((demande = true), { ok: true }));
    expect(await g("Bash", { command: "format c:" })).toMatchObject({ behavior: "deny" });
    expect(demande).toBe(false);
  });

  it("une panne de la demande d'accord = refus (jamais un « oui » par défaut)", async () => {
    const g = await garde(async () => {
      throw new Error("Telegram injoignable");
    });
    expect(await g("mcp__jarvis__pc_clavier", { texte: "x" })).toMatchObject({ behavior: "deny" });
  });
});
