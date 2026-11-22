import { describe, expect, it } from "vitest";
import { bilan, capacites, phraseCapacites, type ContexteCapacites } from "../src/main/capacites.js";

const ctx = (env: Record<string, string>, over: Partial<ContexteCapacites> = {}): ContexteCapacites => ({
  env: (n) => env[n],
  briefings: 0,
  connecteurs: 0,
  documentsBibliotheque: 0,
  motEveilActif: true,
  ...over,
});
const etat = (liste: ReturnType<typeof capacites>, id: string) => liste.find((c) => c.id === id)!;

describe("tableau des capacités", () => {
  it("installation vide : seul l'essentiel est prêt, le reste dit ce qu'il manque", () => {
    const l = capacites(ctx({}));
    expect(etat(l, "voix").etat).toBe("active");
    expect(etat(l, "memoire").etat).toBe("toujours");
    expect(etat(l, "proactif").etat).toBe("active"); // actif par défaut
    expect(etat(l, "maison").etat).toBe("a-configurer");
    expect(etat(l, "maison").manque).toContain("Tapo");
    expect(etat(l, "voiture-obd").etat).toBe("materiel");
    expect(etat(l, "voiture-suivi").etat).toBe("materiel");
    expect(etat(l, "sante-pc").etat).toBe("toujours");
  });

  it("passe à actif quand les réglages sont remplis", () => {
    const l = capacites(ctx({ TAPO_EMAIL: "a@b.c", TAPO_PASSWORD: "x", TELEGRAM_BOT_TOKEN: "1:A", TELEGRAM_CHAT_ID: "42", REVEIL: "on", REVEIL_HEURE: "07:30", SANTE_ACTIVE: "true", ECRAN_VEILLE: "10", USAGE_PLAFOND_JOUR: "2,5" }, { briefings: 1, connecteurs: 2, documentsBibliotheque: 5 }));
    for (const id of ["maison", "alertes", "reveil", "forme", "ecran", "cout", "briefings", "connecteurs", "bibliotheque"]) expect(etat(l, id).etat, id).toBe("active");
  });

  it("distingue désactivé, à configurer et matériel", () => {
    expect(etat(capacites(ctx({ REVEIL: "off" })), "reveil").etat).toBe("desactivee");
    expect(etat(capacites(ctx({ REVEIL: "on" })), "reveil").etat).toBe("a-configurer");
    expect(etat(capacites(ctx({ RAPPEL_PROACTIF: "off" })), "proactif").etat).toBe("desactivee");
    expect(etat(capacites(ctx({ VOITURE_TRACCAR_URL: "http://x:8082" })), "voiture-suivi").etat).toBe("a-configurer");
    expect(etat(capacites(ctx({ VOITURE_TRACCAR_URL: "http://x:8082", VOITURE_TRACCAR_TOKEN: "t" })), "voiture-suivi").etat).toBe("active");
    expect(etat(capacites(ctx({}, { motEveilActif: false })), "voix").etat).toBe("a-configurer");
  });

  it("compte et résume pour la voix", () => {
    const l = capacites(ctx({}));
    const b = bilan(l);
    expect(b.total).toBe(l.length);
    expect(b.actives).toBe(l.filter((c) => c.etat === "active" || c.etat === "toujours").length);
    expect(b.aFaire.every((c) => c.etat === "a-configurer")).toBe(true);
    const p = phraseCapacites(l);
    expect(p).toContain(`${b.total} choses`);
    expect(p).toContain("À configurer");
  });

  it("chaque capacité à configurer pointe vers un groupe de réglages", () => {
    for (const c of capacites(ctx({}))) if (c.etat === "a-configurer") expect(c.groupe || c.id === "bibliotheque", c.id).toBeTruthy();
  });
});
