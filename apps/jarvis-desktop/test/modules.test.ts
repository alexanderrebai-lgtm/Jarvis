import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Budget, categorize, DEFAULT_RULES, parseAmount, parseBankCsv } from "../src/main/budget.js";
import { parseBoardList } from "../src/main/electronics.js";
import { Garage } from "../src/main/garage.js";
import { addNotebookEntry, Lab } from "../src/main/lab.js";
import { Learning, mentorInstruction, reviewCard } from "../src/main/learning.js";
import { chunkPages, extractPdf } from "../src/main/library/extract.js";
import { Bm25, fuseRankings, Library, type Embedder } from "../src/main/library/index.js";
import { benchMarkdown, LocalAI } from "../src/main/local-ai.js";
import { decodeDtc, parseDtcResponse, parseMonitorStatus, parsePid } from "../src/main/obd.js";
import { filingPath, Papers, parseExtraction } from "../src/main/papers.js";
import { summarizeDemo } from "../src/main/procedures.js";
import { invertedToText, Literature, parseArxiv, parseOpenAlex, parsePubmedAbstracts, parseSemanticScholar } from "../src/main/research/literature.js";
import { Routines, runRoutine, Timers } from "../src/main/routines.js";
import { parseFeed, Veille } from "../src/main/veille.js";
import { cosine, VoiceLock } from "../src/main/voiceprint.js";

const tmp = (name: string) => mkdtempSync(path.join(tmpdir(), `${name}-`));

describe("littérature scientifique", () => {
  it("arXiv, OpenAlex, Semantic Scholar, PubMed", () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry><id>http://arxiv.org/abs/2601.00001v1</id><published>2026-01-02T00:00:00Z</published><title>Tire  thermal model</title><summary>We model tyres.</summary><author><name>A. Martin</name></author><author><name>B. Lee</name></author><link href="http://arxiv.org/abs/2601.00001v1" rel="alternate"/><link title="pdf" href="http://arxiv.org/pdf/2601.00001v1"/></entry></feed>`;
    expect(parseArxiv(atom)[0]).toMatchObject({ titre: "Tire thermal model", auteurs: ["A. Martin", "B. Lee"], annee: 2026, pdf: "http://arxiv.org/pdf/2601.00001v1" });
    expect(invertedToText({ tyres: [1], Racing: [0], wear: [2] })).toBe("Racing tyres wear");
    const oa = parseOpenAlex({ results: [{ id: "https://openalex.org/W1", display_name: "Grip", doi: "https://doi.org/10.1/x", publication_year: 2025, cited_by_count: 12, authorships: [{ author: { display_name: "C. Dupont" } }], abstract_inverted_index: { Grip: [0], matters: [1] } }] });
    expect(oa[0]).toMatchObject({ doi: "10.1/x", resume: "Grip matters", citations: 12 });
    const s2 = parseSemanticScholar({ data: [{ title: "Attention", authors: [{ name: "V" }], year: 2017, url: "u", citationCount: 99, externalIds: { DOI: "10.2/y" }, openAccessPdf: { url: "p" } }] });
    expect(s2[0]).toMatchObject({ doi: "10.2/y", pdf: "p", citations: 99 });
    expect(parsePubmedAbstracts("<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>42</PMID><Article><Abstract><AbstractText>Sleep helps.</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>")).toEqual({ "42": "Sleep helps." });
  });

  it("une source en panne n'empêche pas les autres, doublons retirés", async () => {
    const fetchFn = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("arxiv")) return new Response(`<feed><entry><id>a</id><title>Same paper</title><summary>x</summary><author><name>A</name></author><published>2025-01-01</published></entry></feed>`);
      if (u.includes("semanticscholar")) return new Response(JSON.stringify({ data: [{ title: "Same  paper", authors: [], url: "b" }] }));
      return new Response("down", { status: 503 });
    }) as unknown as typeof fetch;
    const result = await new Literature({ fetchFn }).search("paper", { sources: ["arxiv", "semanticscholar", "pubmed"] });
    expect(result.articles).toHaveLength(1);
    expect(result.erreurs[0]).toContain("pubmed");
  });
});

describe("bibliothèque", () => {
  it("découpe, cherche par mots-clés et par sens, cite le fichier et la page", async () => {
    const folder = tmp("biblio");
    writeFileSync(path.join(folder, "volant.md"), "# Base direct drive\n\nLe couple maximal du T300 est d'environ 3,9 Nm. Le retour de force se règle dans le panneau de contrôle.\n\n".repeat(3));
    writeFileSync(path.join(folder, "cuisine.txt"), "La recette des crêpes demande de la farine, des oeufs et du lait. Laisser reposer une heure.");
    const vocab = ["couple", "volant", "force", "crepe", "farine", "recette"];
    const embedder: Embedder = {
      name: "test",
      dimensions: vocab.length,
      embed: async (texts) =>
        texts.map((t) => {
          const v = Float32Array.from(vocab.map((w) => (t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(w) ? 1 : 0)));
          const n = Math.hypot(...v) || 1;
          return v.map((x) => x / n);
        }),
    };
    const lib = new Library({ dataDir: tmp("biblio-data"), folder, embedder });
    expect((await lib.scan()).ajoutes).toBe(2);
    const hits = await lib.search("Quel est le couple du volant ?");
    expect(hits[0]!.titre).toBe("volant");
    expect(hits[0]!.page).toBe(1);
    expect(lib.status()).toMatchObject({ documents: 2, semantique: true });
    // Rechargement depuis le disque : rien à réindexer.
    const again = new Library({ dataDir: path.dirname(path.join(lib.status().dossier, "x")) === folder ? tmp("x") : tmp("y"), folder, embedder });
    expect((await again.scan()).ajoutes).toBe(2);
    expect(chunkPages([{ page: 3, texte: "a. ".repeat(900) }]).every((c) => c.page === 3 && c.texte.length <= 900)).toBe(true);
    expect(new Bm25(["le couple du volant", "farine et lait"]).search("couple")[0]!.index).toBe(0);
    expect(fuseRankings([[{ index: 1 }, { index: 2 }], [{ index: 2 }, { index: 1 }]]).length).toBe(2);
  });

  it("lit le texte d'un PDF page par page", async () => {
    const pdf = minimalPdf(["Bonjour bibliotheque", "Page deux"]);
    const pages = await extractPdf(pdf);
    expect(pages.map((p) => p.page)).toEqual([1, 2]);
    expect(pages[0]!.texte).toContain("Bonjour bibliotheque");
  });
});

/** PDF minimal à plusieurs pages (police Helvetica standard), pour les tests. */
function minimalPdf(texts: string[]): Uint8Array {
  const objects: string[] = [];
  const pageIds = texts.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${texts.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  texts.forEach((t, i) => {
    const stream = `BT /F1 18 Tf 72 720 Td (${t}) Tj ET`;
    objects[pageIds[i]!] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i]! + 1} 0 R >>`;
    objects[pageIds[i]! + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

describe("mentor et révisions", () => {
  it("SM-2 espace les révisions et recommence après un oubli", () => {
    const now = new Date("2026-11-12T08:00:00Z");
    const card = { id: "c", sujet: "s", question: "q", reponse: "r", facilite: 2.5, intervalle: 0, repetitions: 0, prochaine: now.toISOString() };
    const r1 = reviewCard(card, 5, now);
    const r2 = reviewCard(r1, 4, now);
    const r3 = reviewCard(r2, 4, now);
    expect([r1.intervalle, r2.intervalle, r3.intervalle]).toEqual([1, 6, 16]);
    expect(reviewCard(r3, 1, now).intervalle).toBe(1);
    expect(mentorInstruction("fais")).toBe("");
    expect(mentorInstruction("guide")).toContain("Ne donne pas la solution complète");
  });

  it("parcours et fiches", () => {
    const ws = tmp("apprentissage");
    const learning = new Learning(tmp("apprentissage-data"), ws);
    learning.createPath({ sujet: "Réglages de suspension", objectif: "régler seul", niveau: "débutant", etapes: [{ titre: "Ressorts", objectif: "comprendre la raideur" }, { titre: "Amortisseurs", objectif: "bump et rebound" }] });
    learning.completeStep("suspension", 1, "compris");
    expect(learning.listPaths()[0]).toMatchObject({ avancement: "1/2", prochaine: "Amortisseurs" });
    expect(readFileSync(path.join(ws, "apprentissage", "reglages-de-suspension", "PARCOURS.md"), "utf8")).toContain("✅ 1. Ressorts");
    learning.addCards("suspension", [{ question: "Rebound ?", reponse: "Détente" }]);
    expect(learning.due()).toHaveLength(1);
    learning.grade(learning.due()[0]!.id, 5);
    expect(learning.due()).toHaveLength(0);
    learning.setMode("guide");
    expect(learning.mode).toBe("guide");
  });
});

describe("labo", () => {
  it("cahier d'expériences", () => {
    const dir = path.join(tmp("projet"), "support-volant");
    const file = addNotebookEntry(dir, { titre: "Essai de flexion v3", hypothese: "flèche < 0,5 mm", resultats: "0,3 mm à 4 Nm", conclusion: "validé" });
    const text = readFileSync(file, "utf8");
    expect(text).toContain("## Essai de flexion v3");
    expect(text).toContain("**Hypothèse** : flèche < 0,5 mm");
  });

  it.runIf(existsSync("/usr/bin/python3"))("exécute du Python avec la boîte à outils", async () => {
    const assets = path.join(__dirname, "..", "assets");
    const lab = new Lab(tmp("labo"), assets);
    const r = await lab.run("import jarvis_labo as j\nprint(round(j.poutre_console(60, 80, j.section_rectangle(20, 8), 2100)['contrainte_MPa'], 1))");
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("22.5");
  });
});

describe("veille", () => {
  it("lit RSS et Atom, garde les nouveautés", async () => {
    const rss = `<rss><channel><item><title>Réforme &amp; budget</title><link>https://ex.fr/1</link><pubDate>Thu, 12 Nov 2026 06:00:00 GMT</pubDate><description><![CDATA[<p>Le texte</p>]]></description></item></channel></rss>`;
    const atom = `<feed><entry><title>LMU update 1.4</title><link href="https://steam/2"/><updated>2026-11-11T10:00:00Z</updated><summary>New car</summary></entry></feed>`;
    expect(parseFeed(rss, { nom: "fi", url: "", categorie: "france" })[0]).toMatchObject({ titre: "Réforme & budget", resume: "Le texte" });
    expect(parseFeed(atom, { nom: "s", url: "", categorie: "simulation" })[0]).toMatchObject({ titre: "LMU update 1.4", lien: "https://steam/2" });
    const fetchFn = vi.fn(async (url: string | URL) => new Response(String(url).includes("steam") ? atom : rss)) as unknown as typeof fetch;
    const veille = new Veille({ dataDir: tmp("veille"), workspace: tmp("veille-ws"), fetchFn, now: () => new Date("2026-11-12T07:00:00Z") });
    veille.setSources([], veille.sources.map((s) => s.url));
    veille.setSources([{ nom: "fi", url: "https://fi/rss", categorie: "france" }, { nom: "lmu", url: "https://steam/feed", categorie: "simulation" }]);
    expect((await veille.refresh()).nouveaux).toBe(2);
    expect((await veille.refresh()).nouveaux).toBe(0);
    expect(veille.headlines()).toEqual(["Réforme & budget"]);
  });
});

describe("routines et minuteurs", () => {
  it("déclenche « bonne nuit » et exécute ses étapes malgré une erreur", async () => {
    const routines = new Routines(tmp("routines"));
    const r = routines.match("Bonne nuit Jarvis")!;
    expect(r.nom).toBe("Bonne nuit");
    const steps: string[] = [];
    const result = await runRoutine(r, async (s) => {
      steps.push(s.type);
      if (s.type === "lumieres") throw new Error("ampoule injoignable");
      return s.type;
    });
    expect(steps).toEqual(["resume", "pages", "lumieres", "ne_pas_deranger", "ecrans_veille"]);
    expect(result.erreurs).toEqual(["lumieres : ampoule injoignable"]);
    routines.save({ nom: "Cinéma", declencheurs: ["mode cinéma"], etapes: [{ type: "lumieres", cible: "salon", luminosite: 10 }] });
    expect(routines.match("mode cinéma")!.nom).toBe("Cinéma");
    expect(routines.match("allume la lumière")).toBeUndefined();
  });

  it("minuteurs, y compris après un redémarrage", async () => {
    const dir = tmp("minuteurs");
    const done: string[] = [];
    const timers = new Timers(dir, (t) => done.push(t.libelle ?? "?"));
    timers.add(0.05, "pâtes");
    expect(timers.list()[0]!.libelle).toBe("pâtes");
    await new Promise((r) => setTimeout(r, 120));
    expect(done).toEqual(["pâtes"]);
    const t2 = new Timers(dir, () => undefined);
    t2.add(600, "linge");
    const restored: string[] = [];
    new Timers(dir, (t) => restored.push(t.libelle ?? ""), () => Date.now() + 700_000).restore();
    expect(restored).toEqual(["linge"]);
  });
});

describe("garage et OBD", () => {
  it("échéances d'entretien d'après le kilométrage estimé", () => {
    let now = new Date("2026-01-01T12:00:00Z");
    const garage = new Garage(tmp("garage"), () => now);
    garage.addVehicle({ nom: "Golf", marque: "Volkswagen", modele: "Golf 7", kilometrage: 100_000 });
    garage.addService("golf", { date: "2025-12-01", km: 98_000, operation: "Vidange moteur" });
    garage.setPlan("golf", [{ operation: "vidange", intervalleKm: 15_000, intervalleMois: 12 }, { operation: "courroie de distribution", intervalleKm: 120_000 }]);
    now = new Date("2026-03-01T12:00:00Z");
    garage.setMileage("golf", 106_000);
    now = new Date("2026-05-01T12:00:00Z");
    const due = garage.due("golf");
    expect(due[0]).toMatchObject({ operation: "courroie de distribution", etat: "jamais fait" });
    const vidange = due.find((d) => d.operation === "vidange")!;
    expect(vidange.prochainKm).toBe(113_000);
    expect(vidange.etat).toBe("bientôt");
    expect(vidange.resteKm).toBeGreaterThan(500);
    expect(vidange.resteKm).toBeLessThan(1000);
  });

  it("décode les codes défaut et les mesures", () => {
    expect(decodeDtc(0x01, 0x33)).toBe("P0133");
    expect(decodeDtc(0xc1, 0x00)).toBe("U0100");
    expect(parseDtcResponse("43 02 01 33 02 44\r\n")).toEqual(["P0133", "P0244"]);
    expect(parseDtcResponse("43 01 33 00 00 00 00")).toEqual(["P0133"]);
    expect(parseDtcResponse("NO DATA")).toEqual([]);
    expect(parsePid("010C", "41 0C 1A F8")).toMatchObject({ valeur: 1726, unite: "tr/min" });
    expect(parsePid("0105", "SEARCHING...\r\n41 05 7B")).toMatchObject({ valeur: 83 });
    expect(parseMonitorStatus("41 01 83 07 E5 00")).toEqual({ temoinMoteur: true, nombreCodes: 3 });
  });
});

describe("procédures apprises", () => {
  it("résume la démonstration sans les touches tapées", () => {
    const t0 = 1000;
    const lines = summarizeDemo(
      [
        { t: 1500, type: "fenetre", fenetre: "Planning.xlsx - Excel" },
        { t: 2500, type: "clic", x: 120, y: 40 },
        { t: 3000, type: "saisie" },
        { t: 4000, type: "parole", texte: "là j'exporte en PDF" },
      ],
      t0,
    );
    expect(lines).toEqual(["[1 s] Fenêtre active : « Planning.xlsx - Excel »", "[2 s] Clic en (120, 40) dans « Planning.xlsx - Excel »", "[2 s] Alex tape au clavier dans « Planning.xlsx - Excel » (touches non enregistrées)", "[3 s] Alex dit : « là j'exporte en PDF »"]);
  });
});

describe("verrou vocal", () => {
  it("apprend la voix d'Alex et refuse une autre voix", async () => {
    const voiceOf = (seed: number) => Float32Array.from({ length: 32_000 }, (_, i) => Math.sin(i * seed));
    const embedder = { embed: async (a: Float32Array) => Float32Array.from([a[10]! > 0 ? 1 : -1, a[20]!, a[30]!]) };
    const lock = new VoiceLock(tmp("voix"), embedder, "test");
    expect((await lock.verify(voiceOf(0.1))).owner).toBe(true); // pas encore d'empreinte
    lock.startEnrollment();
    let left = 5;
    for (let i = 0; i < 5; i += 1) left = await lock.addEnrollmentSample(voiceOf(0.1));
    expect(left).toBe(0);
    expect(lock.enrolled).toBe(true);
    expect((await lock.verify(voiceOf(0.1))).owner).toBe(true);
    expect((await lock.verify(voiceOf(-0.37))).owner).toBe(false);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
});

describe("IA locale", () => {
  it("choisit un modèle et mesure sa vitesse", async () => {
    const fetchFn = vi.fn(async (url: string | URL) => {
      if (String(url).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "nomic-embed-text:latest", size: 3e8 }, { name: "qwen3:14b", size: 9e9, details: { parameter_size: "14B" } }] }));
      const body = `${JSON.stringify({ message: { content: "<think>hmm</think>Bonjour" } })}\n${JSON.stringify({ done: true, eval_count: 50, eval_duration: 1e9 })}\n`;
      return new Response(body);
    }) as unknown as typeof fetch;
    const ai = new LocalAI({ fetchFn });
    expect(await ai.pickModel()).toBe("qwen3:14b");
    const r = await ai.chat([{ role: "user", content: "salut" }]);
    expect(r.text).toBe("Bonjour");
    expect(r.stats!.jetonsParSeconde).toBe(50);
    expect(benchMarkdown([{ modele: "qwen3:14b", invite: "x", jetonsParSeconde: 50, premierJetonMs: 200, dureeMs: 1000, jetons: 50, reponse: "ok" }])).toContain("| qwen3:14b | 50 | 200 | 1 |");
  });
});

describe("électronique", () => {
  it("lit la liste des cartes d'arduino-cli", () => {
    expect(parseBoardList(JSON.stringify({ detected_ports: [{ port: { address: "COM4", protocol: "serial" }, matching_boards: [{ name: "Arduino Uno", fqbn: "arduino:avr:uno" }] }] }))).toEqual([{ port: "COM4", nom: "Arduino Uno", fqbn: "arduino:avr:uno", protocole: "serial" }]);
  });
});

describe("budget et papiers", () => {
  it("lit deux formats de relevés et classe les opérations", () => {
    const ca = "Date;Libellé;Débit euros;Crédit euros\n03/11/2026;CB CARREFOUR MARKET;45,20;\n05/11/2026;VIR SALAIRE ACME;;2 150,00\n06/11/2026;PRLV FANATEC GMBH;329,00;\n06/11/2026;CB TRUC INCONNU;12,00;";
    const ops = parseBankCsv(ca);
    expect(ops.map((o) => o.montant)).toEqual([-45.2, 2150, -329, -12]);
    const boursorama = 'dateOp,label,amount\n2026-10-02,"NETFLIX.COM",-13.49\n';
    expect(parseBankCsv(boursorama.replace("dateOp", "date operation").replace("label", "libelle").replace("amount", "montant"))[0]).toMatchObject({ date: "2026-10-02", montant: -13.49 });
    expect(parseAmount("1 234,56")).toBe(1234.56);
    expect(categorize("PRLV FANATEC GMBH", -329, DEFAULT_RULES)).toBe("Simulation et jeux");
    const budget = new Budget(tmp("budget"));
    expect(budget.importText(ca, "courant")).toEqual({ ajoutees: 4, total: 4 });
    expect(budget.importText(ca, "courant").ajoutees).toBe(0);
    const s = budget.summary("2026-11");
    expect(s).toMatchObject({ entrees: 2150, sorties: 386.2, aClasser: 1 });
    expect(budget.addRule("truc inconnu", "Divers")).toBe(1);
    expect(budget.summary("2026-11").aClasser).toBe(0);
  });

  it("classe une facture et crée le rappel d'échéance", async () => {
    const root = tmp("papiers");
    const papers = new Papers({
      dataDir: tmp("papiers-data"),
      root,
      extract: async () => parseExtraction('Voici : {"type":"facture","emetteur":"EDF","montant":"82,40","date":"2026-11-03","echeance":"2026-11-25","categorie":"Énergie et eau","resume":"Électricité octobre"}'),
      remind: (p) => `rappel ${p.echeance}`,
      now: () => new Date("2026-11-12T10:00:00Z"),
    });
    const file = path.join(papers.inbox, "scan001.pdf");
    writeFileSync(file, "%PDF");
    const filed = await papers.file(file);
    expect(filed.fichier).toBe(path.join(root, "2026", "Énergie et eau", "2026-11-03_EDF_facture.pdf"));
    expect(existsSync(filed.fichier)).toBe(true);
    expect(filed.montant).toBe(82.4);
    expect(filed.rappel).toBe("rappel 2026-11-25");
    expect(papers.upcoming()).toHaveLength(1);
    mkdirSync(path.join(root, "2026", "Énergie et eau"), { recursive: true });
    expect(filingPath(root, { type: "facture", emetteur: "EDF", categorie: "Énergie et eau", date: "2026-11-03" }, ".pdf", "x")).toContain("-2.pdf");
  });
});
