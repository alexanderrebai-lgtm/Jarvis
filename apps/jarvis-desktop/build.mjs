// Assemble Jarvis : processus principal (Node), passerelle et interface (navigateur).
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const out = "dist";
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, "renderer"), { recursive: true });

// Modules natifs ou qui lancent un programme externe : chargés depuis node_modules, pas empaquetés.
// Chacun doit figurer dans les « dependencies » de ce paquet pour être trouvé au lancement.
const external = ["electron", "@anthropic-ai/claude-agent-sdk", "@huggingface/transformers", "playwright", "tp-link-tapo-connect", "ffmpeg-static", "systeminformation", "pdfjs-dist", "exceljs", "mammoth", "electron-updater"];

await build({
  entryPoints: { main: "src/main/main.ts", preload: "src/main/preload.ts" },
  outdir: out,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  external,
  logLevel: "warning",
});

await build({
  entryPoints: { renderer: "src/renderer/renderer.ts" },
  outdir: path.join(out, "renderer"),
  bundle: true,
  platform: "browser",
  target: "chrome140",
  format: "iife",
  sourcemap: true,
  logLevel: "warning",
});

cpSync("src/renderer/index.html", path.join(out, "renderer", "index.html"));
cpSync("src/renderer/styles.css", path.join(out, "renderer", "styles.css"));
// Polices embarquées (pas de chargement en ligne).
mkdirSync(path.join(out, "renderer", "fonts"), { recursive: true });
cpSync("node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", path.join(out, "renderer", "fonts", "inter.woff2"));
cpSync("node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2", path.join(out, "renderer", "fonts", "space-grotesk.woff2"));
cpSync("design/jetbrains-mono.woff2", path.join(out, "renderer", "fonts", "jetbrains-mono.woff2"));
// Fichiers de calcul (WebAssembly) de la reconnaissance des gestes.
const vision = path.join("node_modules", "@mediapipe", "tasks-vision");
cpSync(path.join(vision, "wasm"), path.join(out, "renderer", "wasm"), { recursive: true });
console.log("Jarvis assemblé dans dist/");
