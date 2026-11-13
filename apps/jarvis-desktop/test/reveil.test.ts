import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { WakeUp, wakeTaskScript } from "../src/main/reveil/alarm.js";
import { extractShifts, parseDate, parseShiftCell, PlanningReader, readPlanningFile, type Grid } from "../src/main/reveil/planning.js";
import { DEFAULT_RULES, nextAlarm, parseDays, sayTime, zonedTime } from "../src/main/reveil/schedule.js";
import { SpotifyClient, toSpotifyUri } from "../src/main/reveil/spotify.js";

const today = new Date("2026-11-12T10:00:00Z");

describe("cases du planning", () => {
  it("lit les horaires et les repos", () => {
    expect(parseShiftCell("08:30-16:30")).toEqual({ debut: "08:30", fin: "16:30", repos: false });
    expect(parseShiftCell("9h à 17h30")).toEqual({ debut: "09:00", fin: "17:30", repos: false });
    expect(parseShiftCell("RH")).toEqual({ repos: true, libelle: "RH" });
    expect(parseShiftCell("CP")!.repos).toBe(true);
    expect(parseShiftCell(0.354166)).toEqual({ debut: "08:30", repos: false });
    expect(parseShiftCell("M", { M: "08:00-15:00" })).toMatchObject({ debut: "08:00", fin: "15:00", libelle: "M" });
    expect(parseShiftCell("réunion")).toBeUndefined();
  });

  it("lit les dates", () => {
    expect(parseDate("lun. 16/11", today)).toBe("2026-11-16");
    expect(parseDate("03/01", today)).toBe("2027-01-03");
    expect(parseDate("13 novembre", today)).toBe("2026-11-13");
    expect(parseDate(new Date(Date.UTC(2026, 10, 17)), today)).toBe("2026-11-17");
    expect(parseDate(46343, today)).toBe("2026-11-17");
    expect(parseDate("Karim", today)).toBeUndefined();
  });
});

describe("planning d'équipe", () => {
  it("grille conseillers × jours", () => {
    const grid: Grid = {
      sheet: "Semaine 47",
      rows: [
        ["Planning équipe", null, null, null],
        ["Nom", "lun 16/11", "mar 17/11", "mer 18/11"],
        ["Léa Martin", "08:00-16:00", "RH", "08:00-16:00"],
        ["Alex Dupont", "09:00-17:00", "10h-18h", "CP"],
      ],
    };
    expect(extractShifts([grid], ["Alex"], { today })).toEqual([
      { date: "2026-11-16", debut: "09:00", fin: "17:00", repos: false },
      { date: "2026-11-17", debut: "10:00", fin: "18:00", repos: false },
      { date: "2026-11-18", repos: true, libelle: "CP" },
    ]);
  });

  it("grille jours × personnes et liste avec colonnes", () => {
    const byColumns: Grid = { sheet: "A", rows: [["Date", "Léa", "Alex"], ["16/11/2026", "8h-16h", "9h-17h"], ["17/11/2026", "RH", "repos"]] };
    expect(extractShifts([byColumns], ["Alex"], { today }).map((s) => s.debut ?? "repos")).toEqual(["09:00", "repos"]);
    const list: Grid = { sheet: "B", rows: [["Date", "Début", "Fin"], ["2026-11-16", "07:30", "15:30"]] };
    expect(extractShifts([list], ["Alex"], { today })).toEqual([{ date: "2026-11-16", debut: "07:30", fin: "15:30", repos: false }]);
  });

  it("lit un vrai fichier Excel (heures en cellules de temps)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "planning-"));
    const file = path.join(dir, "planning.xlsx");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Novembre");
    ws.addRow(["Conseiller", new Date(Date.UTC(2026, 10, 16)), new Date(Date.UTC(2026, 10, 17))]);
    ws.addRow(["Karim", "08:00-16:00", "RH"]);
    const row = ws.addRow(["Alex", new Date(Date.UTC(1899, 11, 30, 9, 15)), "RH"]);
    row.getCell(2).numFmt = "hh:mm";
    await wb.xlsx.writeFile(file);
    const grids = await readPlanningFile(file);
    expect(extractShifts(grids, ["Alex"], { today }).map((s) => s.debut ?? "repos")).toEqual(["09:15", "repos"]);
    const ask = vi.fn();
    const reader = new PlanningReader({ file: () => file, owners: ["Alex"], askClaude: ask });
    const info = await reader.read();
    expect(info!.methode).toBe("automatique");
    expect(info!.collegues).toContain("Karim");
    expect(ask).not.toHaveBeenCalled();
  });

  it("demande à Claude quand le format est inconnu, noms masqués", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "planning-"));
    const file = path.join(dir, "bizarre.csv");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, "Equipe;Infos\nKarim;semaine du 16 : matin\nAlex;semaine du 16 : après-midi\n");
    const ask = vi.fn(async (text: string) => {
      expect(text).not.toContain("Karim");
      return [{ date: "2026-11-16", debut: "13:00", repos: false }];
    });
    const reader = new PlanningReader({ file: () => file, owners: ["Alex"], askClaude: ask, mask: (t, names) => names.reduce((acc, n) => acc.replaceAll(n, "Collègue A"), t) });
    const info = await reader.read();
    expect(info!.methode).toBe("claude");
    expect(info!.horaires[0]!.debut).toBe("13:00");
  });
});

describe("heure du réveil", () => {
  const tz = "Europe/Paris";

  it("poste à 9 h → réveil 75 minutes avant ; repos → pas de réveil", () => {
    const now = new Date("2026-11-12T22:00:00Z");
    const shifts = [{ date: "2026-11-13", debut: "09:00", repos: false }, { date: "2026-11-14", repos: true }];
    const next = nextAlarm(now, tz, shifts, DEFAULT_RULES);
    expect(next!.date).toBe("2026-11-13");
    expect(next!.heure).toBe("07:45");
    expect(next!.at.toISOString()).toBe("2026-11-13T06:45:00.000Z");
    expect(next!.raison).toContain("poste à 9 heures");
  });

  it("sans planning : 7 h 45 les jours de semaine, rien le week-end", () => {
    const saturday = new Date("2026-11-14T08:00:00Z");
    const next = nextAlarm(saturday, tz, [], DEFAULT_RULES);
    expect(next!.date).toBe("2026-11-16");
    expect(next!.heure).toBe("07:45");
  });

  it("réglages ponctuels : demain 6 h 30, ou pas de réveil", () => {
    const now = new Date("2026-11-12T22:00:00Z");
    expect(nextAlarm(now, tz, [], DEFAULT_RULES, [{ date: "2026-11-13", heure: "06:30" }])!.heure).toBe("06:30");
    expect(nextAlarm(now, tz, [], DEFAULT_RULES, [{ date: "2026-11-13", aucun: true }])!.date).toBe("2026-11-16");
    expect(nextAlarm(now, tz, [], DEFAULT_RULES, [], ["2026-11-13"])!.date).toBe("2026-11-16");
  });

  it("heure d'été et formats", () => {
    expect(zonedTime("2026-07-01", "07:45", tz).toISOString()).toBe("2026-07-01T05:45:00.000Z");
    expect(parseDays("lun-ven")).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays("1-6")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(sayTime("07:45")).toBe("7 h 45");
    expect(sayTime("08:00")).toBe("8 heures");
  });
});

describe("déroulé du réveil", () => {
  function setup(musicOk = true) {
    let now = new Date("2026-11-13T06:30:00Z"); // 7 h 30 à Paris
    const said: string[] = [];
    const lights: number[] = [];
    const music = { start: vi.fn(async () => musicOk), volume: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
    const ring = vi.fn();
    const wake = new WakeUp({
      dataDir: mkdtempSync(path.join(tmpdir(), "reveil-")),
      timeZone: "Europe/Paris",
      ownerName: "Alex",
      rules: () => DEFAULT_RULES,
      shifts: async () => [{ date: "2026-11-13", debut: "09:00", repos: false }],
      music,
      lights: async (level) => void lights.push(level),
      prepareGreeting: async () => "Il fait 8 degrés, ton poste commence à 9 heures.",
      say: (t) => said.push(t),
      ring,
      wakeScreen: vi.fn(),
      notify: vi.fn(),
      now: () => now,
    });
    return { wake, said, lights, music, ring, advance: (min: number) => (now = new Date(now.getTime() + min * 60_000)) };
  }

  it("aube, musique, puis message du matin quand Alex est debout", async () => {
    const { wake, said, lights, music, advance } = setup();
    await wake.tick();
    expect(wake.status().prochain!.heure).toBe("07:45");
    advance(7); // 7 h 37 : lever de soleil
    await wake.tick();
    expect(wake.status().phase).toBe("aube");
    advance(8); // 7 h 45
    await wake.tick();
    expect(wake.status().phase).toBe("sonne");
    expect(music.start).toHaveBeenCalled();
    expect(lights.at(-1)).toBe(1);
    expect(await wake.confirmAwake()).toBe(true);
    expect(said.at(-1)).toContain("Bonjour Alex. Il est 7 h 45. Il fait 8 degrés");
    expect(music.volume).toHaveBeenCalledWith(12);
  });

  it("sonnerie de secours, relances et arrêt après 30 minutes", async () => {
    const { wake, said, ring, advance } = setup(false);
    advance(15);
    await wake.tick();
    expect(ring).toHaveBeenCalledWith(true);
    advance(5);
    await wake.tick();
    expect(said.at(-1)).toContain("il est 7 h 50");
    advance(26);
    await wake.tick();
    expect(wake.status().phase).toBe("attente");
    expect(ring).toHaveBeenLastCalledWith(false);
  });

  it("encore cinq minutes", async () => {
    const { wake, music, advance } = setup();
    advance(15);
    await wake.tick();
    await wake.snooze(5);
    expect(wake.status().phase).toBe("repousse");
    advance(5);
    await wake.tick();
    expect(wake.status().phase).toBe("sonne");
    expect(music.start).toHaveBeenCalledTimes(2);
  });

  it("tâche Windows de sortie de veille", () => {
    const script = wakeTaskScript(new Date("2026-11-13T06:39:00Z"));
    expect(script).toContain("-WakeToRun");
    expect(script).toContain("Register-ScheduledTask");
  });
});

describe("Spotify", () => {
  it("reconnaît les liens de playlist", () => {
    expect(toSpotifyUri("https://open.spotify.com/intl-fr/playlist/37i9dQZF1DX0UrRvztWcAU?si=abc")).toBe("spotify:playlist:37i9dQZF1DX0UrRvztWcAU");
    expect(toSpotifyUri("spotify:playlist:abc123")).toBe("spotify:playlist:abc123");
    expect(toSpotifyUri("ma playlist")).toBeUndefined();
  });

  it("rafraîchit le jeton, trouve l'appli du PC et lance la lecture", async () => {
    let tokens: { access: string; refresh: string; expiresAt: number } | undefined = { access: "", refresh: "r1", expiresAt: 0 };
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? "GET"} ${u.replace("https://api.spotify.com/v1", "")}`);
      if (u.includes("accounts.spotify.com")) return new Response(JSON.stringify({ access_token: "a1", expires_in: 3600 }), { status: 200 });
      if (u.includes("/me/player/devices")) return new Response(JSON.stringify({ devices: [{ id: "tel", name: "iPhone", type: "Smartphone", is_active: false, volume_percent: 50 }, { id: "pc", name: "PC-ALEX", type: "Computer", is_active: false, volume_percent: 40 }] }), { status: 200 });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const client = new SpotifyClient({ clientId: "cid", load: () => tokens, save: (t) => (tokens = t), fetchFn });
    const device = await client.ensureDevice(() => undefined);
    expect(device!.id).toBe("pc");
    await client.play({ deviceId: "pc", contextUri: "spotify:playlist:x" });
    await client.volume(30, "pc");
    expect(tokens!.access).toBe("a1");
    expect(tokens!.refresh).toBe("r1");
    expect(calls).toContain("PUT /me/player/play?device_id=pc");
    expect(calls).toContain("PUT /me/player/volume?volume_percent=30&device_id=pc");
  });
});

describe("erreurs Spotify en français", () => {
  it("lit une réponse en texte brut sans planter", async () => {
    const fetchFn = (async (url: string | URL) =>
      String(url).includes("accounts.spotify.com") ? new Response(JSON.stringify({ access_token: "a", expires_in: 3600 })) : new Response("Active premium subscription required for the owner of the app.", { status: 403 })) as unknown as typeof fetch;
    let tokens: { access: string; refresh: string; expiresAt: number } | undefined = { access: "", refresh: "r", expiresAt: 0 };
    const client = new SpotifyClient({ clientId: "c", load: () => tokens, save: (t) => (tokens = t), fetchFn });
    await expect(client.devices()).rejects.toThrow(/compte qui a créé l'appli/);
  });
});
