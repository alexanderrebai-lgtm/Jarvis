import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnv, SettingsStore, updateEnvText } from "../src/main/settings.js";
import { Vault } from "../src/main/vault.js";

const cipher = { available: () => true, encrypt: (t: string) => Buffer.from(`X${t}`), decrypt: (b: Buffer) => b.toString().slice(1) };

describe("page Réglages", () => {
  it("garde les commentaires et ajoute les réglages manquants", () => {
    const text = "# Ville\nJARVIS_VILLE=\nOWNER_NAME=Alex\n";
    const next = updateEnvText(text, { JARVIS_VILLE: "Lyon", PLANNING_FICHIER: "C:\\planning.xlsx" });
    expect(next).toContain("# Ville\nJARVIS_VILLE=Lyon");
    expect(parseEnv(next)).toMatchObject({ OWNER_NAME: "Alex", PLANNING_FICHIER: "C:\\planning.xlsx" });
  });

  it("range les mots de passe au coffre et ne les renvoie jamais à l'écran", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "reglages-"));
    const file = path.join(dir, "jarvis.env");
    writeFileSync(file, "TAPO_EMAIL=\nTAPO_PASSWORD=\n");
    const env: NodeJS.ProcessEnv = {};
    const store = new SettingsStore(file, new Vault(dir, cipher), env);
    const r = store.save({ TAPO_EMAIL: "a@b.fr", TAPO_PASSWORD: "Zx9-motdepasse", INCONNU: "x" });
    expect(r.enregistres).toEqual(["TAPO_EMAIL", "TAPO_PASSWORD"]);
    expect(r.redemarrage).toEqual(["TAPO_EMAIL", "TAPO_PASSWORD"]);
    expect(readFileSync(file, "utf8")).toContain("TAPO_PASSWORD=@coffre");
    expect(readFileSync(file, "utf8")).not.toContain("Zx9-motdepasse");
    expect(env.TAPO_PASSWORD).toBe("Zx9-motdepasse");
    const view = store.view();
    expect(view.valeurs.TAPO_EMAIL).toBe("a@b.fr");
    expect(view.secrets.TAPO_PASSWORD).toBe(true);
    expect(JSON.stringify(view)).not.toContain("Zx9-motdepasse");
    store.save({}, ["TAPO_PASSWORD"]);
    expect(store.view().secrets.TAPO_PASSWORD).toBe(false);
  });
});

describe("Telegram", async () => {
  const { explainTelegram, isTelegramChatId, isTelegramToken } = await import("../src/main/phone.js");
  it("reconnaît le nom du bot et explique l'erreur 400 en français", () => {
    expect(isTelegramChatId("Czgqfisjvru_bot")).toBe(false);
    expect(isTelegramChatId("123456789")).toBe(true);
    expect(isTelegramToken("123456789:AAHabcdefghijklmnopqrstuvwxyz0123456")).toBe(true);
    expect(isTelegramToken("Czgqfisjvru_bot")).toBe(false);
    expect(explainTelegram(400, "Bad Request: chat not found")).toContain("Trouver ma conversation");
    expect(explainTelegram(401)).toContain("@BotFather");
  });
});
