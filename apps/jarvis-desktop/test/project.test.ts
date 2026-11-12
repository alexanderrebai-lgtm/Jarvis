import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { insideProject, ProjectView } from "../src/main/project-view.js";

function project() {
  const root = mkdtempSync(path.join(tmpdir(), "jarvis-projet-"));
  mkdirSync(path.join(root, "src"));
  mkdirSync(path.join(root, "node_modules", "x"), { recursive: true });
  writeFileSync(path.join(root, "src", "app.ts"), "export const vitesse = 287;\n");
  writeFileSync(path.join(root, "index.html"), "<h1>Tableau de bord</h1>");
  writeFileSync(path.join(root, "support.stl"), "solid x\nendsolid x\n");
  writeFileSync(path.join(root, "JOURNAL.md"), "# Support volant\n\n- v3 : nervures ajoutées");
  writeFileSync(path.join(root, "node_modules", "x", "index.js"), "ignored");
  return root;
}

describe("vue de projet (pages Code et R&D)", () => {
  it("liste les fichiers utiles, montre le code, l'aperçu et le journal", () => {
    const root = project();
    const changes: number[] = [];
    const view = new ProjectView((s) => changes.push(s.apercu?.version ?? 0));
    const snap = view.show(root, { fichier: "src/app.ts", apercu: "index.html" });
    expect(snap.fichiers.map((f) => f.chemin)).toEqual(["index.html", "JOURNAL.md", "src/app.ts", "support.stl"]);
    expect(snap.fichier).toEqual({ chemin: "src/app.ts", contenu: "export const vitesse = 287;\n", langage: "typescript" });
    expect(snap.apercu).toMatchObject({ type: "fichier", chemin: "index.html", genre: "page" });
    expect(snap.journal).toContain("nervures");
    expect(snap.medias.map((m) => m.chemin)).toEqual(["support.stl"]);
    expect(view.show(root, { apercu: "http://localhost:5173/" }).apercu).toMatchObject({ type: "url", url: "http://localhost:5173/" });
    expect(view.read("index.html")?.toString()).toContain("Tableau");
    view.close();
  });

  it("refuse de sortir du projet et les aperçus douteux", () => {
    const root = project();
    const view = new ProjectView(() => undefined);
    expect(() => view.show(root, { fichier: "../../etc/passwd" })).toThrow(/pas dans le projet/);
    expect(() => view.show(root, { apercu: "https://site-inconnu.com" })).toThrow(/Aperçu impossible/);
    expect(view.read("../secret.txt")).toBeUndefined();
    expect(insideProject("/a/b", "c/../../d")).toBeUndefined();
    view.close();
  });
});
