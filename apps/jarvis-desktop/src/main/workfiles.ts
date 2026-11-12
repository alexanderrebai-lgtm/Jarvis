import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractDocument } from "./library/extract.js";
import type { Pseudonymizer } from "./privacy.js";
import { gridAsText, peopleNames, readPlanningFile } from "./reveil/planning.js";

/**
 * Documents de travail : lus sur le PC, les noms de l'équipe remplacés par des
 * alias avant d'aller vers Claude ; et l'inverse pour les fichiers produits.
 */

export async function readWorkFile(file: string, privacy: Pseudonymizer, sheet?: string): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  let text: string;
  if ([".xlsx", ".xlsm", ".csv", ".tsv"].includes(ext)) {
    const grids = await readPlanningFile(file);
    privacy.learn(peopleNames(grids));
    const chosen = sheet ? grids.filter((g) => g.sheet.toLowerCase().includes(sheet.toLowerCase())) : grids;
    text = (chosen.length ? chosen : grids).map((g) => gridAsText(g, 600, 80)).join("\n\n");
  } else {
    text = (await extractDocument(file)).map((p) => (p.page > 1 ? `\n[page ${p.page}]\n${p.texte}` : p.texte)).join("\n");
  }
  const masked = privacy.mask(text);
  return masked.length > 80_000 ? `${masked.slice(0, 80_000)}\n… [tronqué : demande une feuille ou une partie précise]` : masked;
}

/** Remet les vrais noms dans un fichier produit (texte ou Excel). */
export async function unmaskWorkFile(file: string, privacy: Pseudonymizer): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  if ([".md", ".txt", ".csv", ".tsv", ".json", ".html", ".htm"].includes(ext)) {
    const before = await readFile(file, "utf8");
    const after = privacy.unmask(before);
    await writeFile(file, after);
    return before === after ? "Aucun alias à remplacer." : "Vrais noms remis dans le fichier.";
  }
  if (ext === ".xlsx" || ext === ".xlsm") {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    let changed = 0;
    wb.eachSheet((ws) =>
      ws.eachRow((row) =>
        row.eachCell((cell) => {
          if (typeof cell.value === "string") {
            const next = privacy.unmask(cell.value);
            if (next !== cell.value) {
              cell.value = next;
              changed += 1;
            }
          }
        }),
      ),
    );
    await wb.xlsx.writeFile(file);
    return `${changed} cellule(s) corrigée(s).`;
  }
  throw new Error("Je sais remettre les noms dans les fichiers texte, Markdown, CSV et Excel. Pour un Word, écris d'abord en Markdown.");
}
