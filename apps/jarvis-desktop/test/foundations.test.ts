import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ActionLog, FileVersions, recycleScript, summarizeInput } from "../src/main/actions.js";
import { createBackup, selectKept } from "../src/main/backup.js";
import { Pseudonymizer } from "../src/main/privacy.js";
import { BackgroundTasks } from "../src/main/tasks.js";
import { migrateEnvSecrets, Vault, type Cipher } from "../src/main/vault.js";
import { parseClock, parseDuration, parseIntent } from "../src/shared/intents.js";
import { decide, deletionTargets, protectedTarget } from "../src/shared/policy.js";

const tmp = (name: string) => mkdtempSync(path.join(tmpdir(), `${name}-`));
const fakeCipher: Cipher = { available: () => true, encrypt: (t) => Buffer.from(`X${Buffer.from(t).toString("base64")}`), decrypt: (b) => Buffer.from(b.toString().slice(1), "base64").toString() };

describe("coffre-fort", () => {
  it("déplace les secrets de jarvis.env et les remet dans l'environnement", () => {
    const dir = tmp("coffre");
    const env = path.join(dir, "jarvis.env");
    writeFileSync(env, "OWNER_NAME=Alex\nTAPO_PASSWORD=secret123\nTAPO_EMAIL=a@b.c\nTELEGRAM_BOT_TOKEN=\n");
    const vault = new Vault(dir, fakeCipher);
    const fakeEnv: NodeJS.ProcessEnv = { TAPO_PASSWORD: "secret123" };
    expect(migrateEnvSecrets(env, vault, fakeEnv)).toEqual(["TAPO_PASSWORD"]);
    expect(readFileSync(env, "utf8")).toContain("TAPO_PASSWORD=@coffre");
    expect(readFileSync(env, "utf8")).not.toContain("secret123");
    expect(readFileSync(path.join(dir, "coffre.bin"), "utf8")).not.toContain("secret123");
    const later: NodeJS.ProcessEnv = { TAPO_PASSWORD: "@coffre" };
    migrateEnvSecrets(env, new Vault(dir, fakeCipher), later);
    expect(later.TAPO_PASSWORD).toBe("secret123");
  });

  it("ne touche à rien sans chiffrement disponible", () => {
    const dir = tmp("coffre");
    const env = path.join(dir, "jarvis.env");
    writeFileSync(env, "TAPO_PASSWORD=secret\n");
    expect(migrateEnvSecrets(env, new Vault(dir, { ...fakeCipher, available: () => false }), {})).toEqual([]);
    expect(readFileSync(env, "utf8")).toContain("secret");
  });
});

describe("sauvegardes", () => {
  it("archive les dossiers sans node_modules et garde 14 jours + 8 semaines", async () => {
    const root = tmp("sauvegarde");
    const projets = path.join(root, "projets");
    mkdirSync(path.join(projets, "volant", "node_modules", "x"), { recursive: true });
    writeFileSync(path.join(projets, "volant", "JOURNAL.md"), "# Support volant\n");
    writeFileSync(path.join(projets, "volant", "node_modules", "x", "index.js"), "ignored");
    const result = await createBackup({ sources: [{ nom: "projets", dossier: projets }], destination: path.join(root, "sauvegardes") }, new Date("2026-11-12T03:00:00Z"));
    const files = unzipSync(readFileSync(result.fichier));
    expect(Object.keys(files)).toEqual(["projets/volant/JOURNAL.md"]);
    expect(new TextDecoder().decode(files["projets/volant/JOURNAL.md"])).toContain("Support volant");
    const names = Array.from({ length: 70 }, (_, i) => `jarvis-${new Date(Date.UTC(2026, 10, 12) - i * 86_400_000).toISOString().slice(0, 10)}.zip`);
    const kept = selectKept(names);
    expect(kept.size).toBeGreaterThanOrEqual(14);
    expect(kept.size).toBeLessThanOrEqual(22);
    expect(kept.has(names[0]!)).toBe(true);
    expect(kept.has(names[69]!)).toBe(false);
  });
});

describe("traçabilité", () => {
  it("journal des actions, copies avant modification, corbeille", () => {
    const dir = tmp("actions");
    const log = new ActionLog(dir);
    log.add({ outil: "pc_powershell", resume: summarizeInput("mcp__jarvis__pc_powershell", { script: "Get-Process" }), autorise: true });
    expect(log.day()[0]!.resume).toBe("pc_powershell : Get-Process");
    const file = path.join(dir, "notes.txt");
    writeFileSync(file, "v1");
    const versions = new FileVersions(dir);
    expect(versions.snapshot(file)).toBeDefined();
    expect(versions.snapshot(file)).toBeUndefined(); // une seule copie par 10 minutes
    writeFileSync(file, "v2");
    const [first] = versions.list(file);
    versions.restore(first!.version, file);
    expect(readFileSync(file, "utf8")).toBe("v1");
    expect(recycleScript(["C:\\Users\\alex\\x.txt"])).toContain("SendToRecycleBin");
  });
});

describe("règles de sécurité", () => {
  it("les suppressions passent par la corbeille, sauf dossiers de compilation", () => {
    expect(deletionTargets("Remove-Item -Recurse -Force C:\\Users\\alex\\projet")).toEqual(["C:\\Users\\alex\\projet"]);
    expect(decide("mcp__jarvis__pc_powershell", { script: "Remove-Item -Recurse .\\projet\\src" }).allow).toBe(false);
    expect(decide("Bash", { command: "rm -rf node_modules dist" }).allow).toBe(true);
    expect(decide("Bash", { command: "git rm --cached x.txt" }).allow).toBe(true);
    expect(decide("Bash", { command: "npm test && rm notes.txt" }).allow).toBe(false);
    expect(decide("mcp__jarvis_plus__fichier_corbeille", { chemins: ["C:\\"] }).allow).toBe(false);
    expect(decide("mcp__jarvis_plus__fichier_corbeille", { chemins: ["C:\\Users\\alex"] }).allow).toBe(false);
    expect(decide("mcp__jarvis_plus__fichier_corbeille", { chemins: ["C:\\Users\\alex\\Documents\\Jarvis\\brouillon.txt"] }).allow).toBe(true);
    expect(protectedTarget("C:\\Windows")).toBe(true);
  });

  it("une voix inconnue ne peut que poser des questions", () => {
    expect(decide("WebSearch", {}, { trust: "inconnu" }).allow).toBe(true);
    expect(decide("mcp__jarvis__tapo_commande", {}, { trust: "inconnu" }).allow).toBe(false);
    expect(decide("mcp__jarvis__securite_surveillance", { active: false }, { trust: "inconnu" }).allow).toBe(false);
    expect(decide("mcp__jarvis__tapo_commande", {}, { trust: "proprietaire" }).allow).toBe(true);
  });

  it("les documents de travail ne se lisent qu'avec pseudonymes", () => {
    const ctx = { workFolder: "C:\\Users\\alex\\Documents\\Jarvis\\travail" };
    expect(decide("Read", { file_path: "C:/Users/alex/Documents/Jarvis/travail/planning.xlsx" }, ctx).allow).toBe(false);
    expect(decide("Bash", { command: "Get-Content C:\\Users\\alex\\Documents\\Jarvis\\travail\\equipe.csv" }, ctx).allow).toBe(false);
    expect(decide("Bash", { command: "dir C:\\Users\\alex\\Documents\\Jarvis\\travail" }, ctx).allow).toBe(true);
    expect(decide("Write", { file_path: "C:\\Users\\alex\\Documents\\Jarvis\\travail\\bilan.md" }, ctx).allow).toBe(true);
  });
});

describe("pseudonymes", () => {
  it("masque et rétablit les noms de l'équipe", () => {
    const p = new Pseudonymizer(tmp("pseudo"), ["Alex"]);
    p.learn(["Karim Benali", "Léa Martin", "Alex", "Inès"]);
    const masked = p.mask("Karim a une DMT élevée, Lea aussi ; Karim Benali en entretien. Alex valide. Inès ok.");
    expect(masked).not.toMatch(/Karim|Léa|Lea|Inès|Benali/);
    expect(masked).toContain("Alex");
    expect(masked).toContain("Conseiller A");
    expect(p.unmask(masked)).toContain("Karim Benali en entretien");
    expect(p.unmask("Conseiller B progresse.")).toBe("Léa Martin progresse.");
  });
});

describe("tâches de fond", () => {
  it("lance, suit et annonce une tâche, deux à la fois au plus", async () => {
    const done: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const tasks = new BackgroundTasks({
      dataDir: tmp("taches"),
      run: async (consigne, events) => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        events.onTool("je cherche sur le web");
        await new Promise((r) => setTimeout(r, 20));
        running -= 1;
        return { text: `Fini : ${consigne}` };
      },
      onDone: (t) => done.push(t.resultat ?? ""),
    });
    tasks.launch("A", "a");
    tasks.launch("B", "b");
    const c = tasks.launch("C", "c");
    await new Promise((r) => setTimeout(r, 120));
    expect(done).toHaveLength(3);
    expect(maxRunning).toBe(2);
    expect(tasks.get(c.id)!.etapes).toEqual(["je cherche sur le web"]);
  });
});

describe("réflexes", () => {
  it("lumières", () => {
    expect(parseIntent("Allume la lampe du salon")).toEqual({ type: "lumiere", cible: "salon", action: "allumer" });
    expect(parseIntent("éteins tout")).toEqual({ type: "lumiere", cible: "tout", action: "eteindre" });
    expect(parseIntent("Éteins les lumières")).toEqual({ type: "lumiere", cible: "toutes les lumieres", action: "eteindre" });
    expect(parseIntent("mets la lumière du salon à 30 %")).toEqual({ type: "lumiere", cible: "salon", luminosite: 30 });
    expect(parseIntent("mets la chambre en bleu")).toEqual({ type: "lumiere", cible: "chambre", couleur: "blue" });
    expect(parseIntent("allume le PC du salon")).toBeUndefined();
    expect(parseIntent("allume la prise simulateur")).toEqual({ type: "lumiere", cible: "simulateur", action: "allumer" });
  });

  it("musique", () => {
    expect(parseIntent("mets de la musique")).toEqual({ type: "musique", action: "lecture" });
    expect(parseIntent("Mets Daft Punk sur Spotify")).toEqual({ type: "musique", action: "lecture", requete: "daft punk" });
    expect(parseIntent("pause")).toEqual({ type: "musique", action: "pause" });
    expect(parseIntent("chanson suivante")).toEqual({ type: "musique", action: "suivant" });
    expect(parseIntent("volume à 40")).toEqual({ type: "musique", action: "volume", volume: 40 });
    expect(parseIntent("monte le son")).toEqual({ type: "musique", action: "volume", delta: 15 });
  });

  it("minuteurs et rappels", () => {
    expect(parseIntent("Mets un minuteur de 10 minutes pour les pâtes")).toEqual({ type: "minuteur", secondes: 600, libelle: "les pâtes" });
    expect(parseIntent("minuteur dix minutes")).toEqual({ type: "minuteur", secondes: 600 });
    expect(parseIntent("lance un chrono de 2 min 30")).toEqual({ type: "minuteur", secondes: 150 });
    expect(parseIntent("Rappelle-moi dans 20 minutes de sortir le linge")).toEqual({ type: "rappel", dans: 1200, texte: "sortir le linge" });
    expect(parseDuration("une demi-heure")).toBe(1800);
    expect(parseDuration("1 h 30")).toBe(5400);
  });

  it("réveil", () => {
    expect(parseIntent("Je suis debout")).toEqual({ type: "reveil", action: "debout" });
    expect(parseIntent("encore cinq minutes")).toEqual({ type: "reveil", action: "repousser", minutes: 5 });
    expect(parseIntent("pas de réveil demain")).toEqual({ type: "reveil", action: "aucun", jour: "demain" });
    expect(parseIntent("réveille-moi à 6 h 30 demain")).toEqual({ type: "reveil", action: "regler", heure: "06:30", jour: "demain" });
    expect(parseIntent("Réveille-moi demain à sept heures et quart")).toEqual({ type: "reveil", action: "regler", heure: "07:15", jour: "demain" });
    expect(parseIntent("à quelle heure tu me réveilles demain ?")).toEqual({ type: "reveil", action: "quand" });
    expect(parseClock("7 heures moins le quart")).toBe("06:45");
  });

  it("surveillance, voix, mentor, et ce qui part vers Claude", () => {
    expect(parseIntent("Active la surveillance complète")).toEqual({ type: "surveillance", mode: "complete" });
    expect(parseIntent("désactive la surveillance")).toEqual({ type: "surveillance", mode: "off" });
    expect(parseIntent("apprends ma voix")).toEqual({ type: "voix", action: "apprendre" });
    expect(parseIntent("guide-moi")).toEqual({ type: "mentor", mode: "guide" });
    expect(parseIntent("Je vais te montrer comment exporter le planning")).toEqual({ type: "demonstration", action: "debut", nom: "exporter le planning" });
    expect(parseIntent("Quelle est la meilleure stratégie de pneus pour Spa ?")).toBeUndefined();
    expect(parseIntent("allume la lumière et explique-moi la relativité générale en détail s'il te plaît")).toBeUndefined();
  });
});

describe("coffre-fort Windows (DPAPI)", () => {
  it("chiffre lisiblement dès le lancement et convertit l'ancien format", async () => {
    const { dpapiCipher, isLegacyVault, migrateLegacyVault, DPAPI_HEADER } = await import("../src/main/vault.js");
    // Faux DPAPI : renvoie l'entrée telle quelle (base64 → base64).
    const cipher = { ...dpapiCipher((_script, input) => input), available: () => true };
    const dir = tmp("dpapi");
    writeFileSync(path.join(dir, "coffre.bin"), fakeCipher.encrypt(JSON.stringify({ GOOGLE_REFRESH_TOKEN: "1//abc" })));
    expect(isLegacyVault(dir)).toBe(true);
    const vault = new Vault(dir, cipher);
    expect(vault.get("GOOGLE_REFRESH_TOKEN")).toBeUndefined();
    expect(migrateLegacyVault(dir, (d) => fakeCipher.decrypt(d), vault)).toBe(1);
    expect(isLegacyVault(dir)).toBe(false);
    expect(readFileSync(path.join(dir, "coffre.bin"), "utf8").startsWith(DPAPI_HEADER)).toBe(true);
    expect(new Vault(dir, cipher).get("GOOGLE_REFRESH_TOKEN")).toBe("1//abc");
  });
});
