import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Extraction du texte des documents de la bibliothèque, page par page quand
 * c'est possible (PDF), pour pouvoir citer « manuel.pdf, p. 42 ».
 */

export interface ExtractedPage {
  page: number;
  texte: string;
}

export const LIBRARY_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".markdown", ".html", ".htm", ".csv", ".json", ".py", ".ts", ".js", ".ino", ".c", ".cpp", ".h"];

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|h\d|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

export async function extractPdf(data: Uint8Array): Promise<ExtractedPage[]> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
    getDocument: (options: Record<string, unknown>) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }> }> }>; destroy: () => Promise<void> };
  };
  const task = pdfjs.getDocument({ data, useSystemFonts: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  const pages: ExtractedPage[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const texte = content.items.map((i) => (i.str ?? "") + (i.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+/g, " ").trim();
      if (texte) pages.push({ page: n, texte });
    }
  } finally {
    await task.destroy();
  }
  return pages;
}

export async function extractDocument(file: string): Promise<ExtractedPage[]> {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".pdf") return extractPdf(new Uint8Array(await readFile(file)));
  if (ext === ".docx") {
    const mammoth = (await import("mammoth")) as unknown as { extractRawText: (o: { path: string }) => Promise<{ value: string }>; default?: { extractRawText: (o: { path: string }) => Promise<{ value: string }> } };
    const extract = mammoth.extractRawText ?? mammoth.default!.extractRawText;
    return [{ page: 1, texte: (await extract({ path: file })).value }];
  }
  const text = await readFile(file, "utf8");
  return [{ page: 1, texte: ext === ".html" || ext === ".htm" ? stripHtml(text) : text }];
}

export interface Chunk {
  page: number;
  texte: string;
}

/** Découpe en passages d'environ `size` caractères qui se chevauchent, sans couper les phrases si possible. */
export function chunkPages(pages: ExtractedPage[], size = 900, overlap = 150): Chunk[] {
  const chunks: Chunk[] = [];
  for (const { page, texte } of pages) {
    const clean = texte.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    let start = 0;
    while (start < clean.length) {
      let end = Math.min(clean.length, start + size);
      if (end < clean.length) {
        const cut = Math.max(clean.lastIndexOf(". ", end), clean.lastIndexOf("\n", end));
        if (cut > start + size * 0.5) end = cut + 1;
      }
      const piece = clean.slice(start, end).trim();
      if (piece.length > 40) chunks.push({ page, texte: piece });
      if (end >= clean.length) break;
      start = Math.max(end - overlap, start + 1);
    }
  }
  return chunks;
}
