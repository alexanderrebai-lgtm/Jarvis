import { describe, expect, it } from "vitest";
import { TelegramInbox, splitMessage, type TelegramInboxOptions, type Update } from "../src/main/telegram-in.js";

const MOI = 4242;
const NOW = 1_800_000_000_000;

function monde(over: Partial<TelegramInboxOptions> = {}) {
  const envoyes: Array<{ methode: string; corps: any }> = [];
  const a_lire: Update[] = [];
  const questions: Array<[string, string]> = [];
  const boutons: string[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/file/bot")) return new Response(Buffer.from("OGGDATA"), { status: 200 });
    const methode = u.split("/").pop()!;
    const corps = init?.body ? JSON.parse(String(init.body)) : {};
    envoyes.push({ methode, corps });
    if (methode === "getUpdates") return Response.json({ ok: true, result: a_lire.splice(0) });
    if (methode === "getFile") return Response.json({ ok: true, result: { file_path: "voice/f.oga" } });
    return Response.json({ ok: true, result: true });
  }) as unknown as typeof fetch;
  const inbox = new TelegramInbox({
    token: () => "123:ABC",
    chatId: () => String(MOI),
    actif: () => true,
    repondre: async (t, o) => (questions.push([t, o]), `réponse à « ${t} »`),
    transcrire: async () => "allume le salon",
    surBouton: (d) => void boutons.push(d),
    fetchFn,
    maintenant: () => NOW,
    ...over,
  });
  const msg = (extra: Partial<NonNullable<Update["message"]>> & { id?: number }, chatId = MOI, type = "private"): Update => ({
    update_id: extra.id ?? 1,
    message: { date: NOW / 1000 - 5, chat: { id: chatId, type }, from: { id: chatId }, ...extra },
  });
  const textes = () => envoyes.filter((e) => e.methode === "sendMessage").map((e) => e.corps.text as string);
  return { inbox, a_lire, envoyes, questions, boutons, msg, textes };
}

describe("telegram dans les deux sens", () => {
  it("répond à ton message texte, dans ta conversation", async () => {
    const m = monde();
    m.a_lire.push(m.msg({ text: "Quelle heure est-il ?" }));
    expect(await m.inbox.sonder(0)).toBe(1);
    expect(m.questions).toEqual([["Quelle heure est-il ?", "texte"]]);
    expect(m.textes()).toEqual(["réponse à « Quelle heure est-il ? »"]);
  });

  it("ignore en silence tout ce qui ne vient pas de ta conversation privée", async () => {
    const m = monde();
    m.a_lire.push(m.msg({ text: "ouvre la porte" }, 999), m.msg({ text: "ouvre la porte", id: 2 }, MOI, "group"), m.msg({ text: "salut", id: 3 }, -100123));
    await m.inbox.sonder(0);
    expect(m.questions).toHaveLength(0);
    expect(m.textes()).toHaveLength(0); // même pas un « accès refusé » : on ne révèle pas que le bot est branché
  });

  it("refuse un message dont l'expéditeur n'est pas toi, même dans le bon salon", async () => {
    const m = monde();
    const u = m.msg({ text: "fais ça" });
    u.message!.from = { id: 1 };
    m.a_lire.push(u);
    await m.inbox.sonder(0);
    expect(m.questions).toHaveLength(0);
  });

  it("n'exécute pas un message ancien (Jarvis était éteint)", async () => {
    const m = monde();
    m.a_lire.push(m.msg({ text: "éteins tout", date: NOW / 1000 - 3600 }));
    await m.inbox.sonder(0);
    expect(m.questions).toHaveLength(0);
    expect(m.textes()[0]).toContain("je ne l'exécute pas");
  });

  it("transcrit un message vocal, dit ce qu'il a compris, puis répond", async () => {
    const m = monde();
    m.a_lire.push(m.msg({ voice: { file_id: "F1", duration: 4 } }));
    await m.inbox.sonder(0);
    expect(m.questions).toEqual([["allume le salon", "vocal"]]);
    expect(m.textes()).toEqual(["🎙 J'ai compris : « allume le salon »", "réponse à « allume le salon »"]);
    expect(m.envoyes.some((e) => e.methode === "getFile" && e.corps.file_id === "F1")).toBe(true);
  });

  it("dit quand un vocal est incompréhensible ou trop long, sans solliciter le cerveau", async () => {
    const m = monde({ transcrire: async () => "  " });
    m.a_lire.push(m.msg({ voice: { file_id: "F2", duration: 3 } }), m.msg({ voice: { file_id: "F3", duration: 600 }, id: 2 }));
    await m.inbox.sonder(0);
    expect(m.questions).toHaveLength(0);
    expect(m.textes()[0]).toContain("pas réussi à comprendre");
    expect(m.textes()[1]).toContain("trop long");
  });

  it("découpe une longue réponse en plusieurs messages", async () => {
    const m = monde({ repondre: async () => `${"mot ".repeat(2500)}fin` });
    m.a_lire.push(m.msg({ text: "raconte" }));
    await m.inbox.sonder(0);
    expect(m.textes().length).toBeGreaterThan(1);
    expect(m.textes().every((t) => t.length <= 4000)).toBe(true);
    expect(splitMessage("a".repeat(9000)).map((p) => p.length)).toEqual([4000, 4000, 1000]);
  });

  it("transmet les clics de bouton, mais seulement les tiens", async () => {
    const m = monde();
    m.a_lire.push(
      { update_id: 1, callback_query: { id: "c1", data: "ok:abc", from: { id: MOI }, message: { chat: { id: MOI, type: "private" } } } },
      { update_id: 2, callback_query: { id: "c2", data: "ok:pirate", from: { id: 7 }, message: { chat: { id: 7, type: "private" } } } },
    );
    await m.inbox.sonder(0);
    expect(m.boutons).toEqual(["ok:abc"]);
  });

  it("répond à /start sans déranger le cerveau, et rapporte une panne du cerveau poliment", async () => {
    const m = monde({ repondre: async () => { throw new Error("Claude indisponible"); } });
    m.a_lire.push(m.msg({ text: "/start" }), m.msg({ text: "bonjour", id: 2 }));
    await m.inbox.sonder(0);
    expect(m.textes()[0]).toContain("Jarvis ici");
    expect(m.textes()[1]).toContain("Je n'ai pas pu répondre : Claude indisponible");
  });

  it("signale un conflit quand un autre programme lit déjà le bot, et continue d'essayer", async () => {
    let appels = 0;
    const fetchFn = (async () => (++appels, Response.json({ ok: false, description: "Conflict: terminated by other getUpdates request" }, { status: 409 }))) as unknown as typeof fetch;
    const inbox = new TelegramInbox({ token: () => "1:A", chatId: () => String(MOI), actif: () => true, repondre: async () => "", transcrire: async () => undefined, fetchFn, attenteErreurMs: 5 });
    inbox.start();
    await new Promise((r) => setTimeout(r, 120));
    inbox.stop();
    expect(inbox.etat === "conflit" || inbox.etat === "arret").toBe(true);
    expect(inbox.derniereErreur).toContain("autre programme");
    expect(appels).toBeGreaterThan(0);
  });
});
