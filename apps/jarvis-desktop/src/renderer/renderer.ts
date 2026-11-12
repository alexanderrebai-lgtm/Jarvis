import { startBackground } from "./hud.js";
import { renderHome } from "./pages/accueil.js";
import { renderBubble } from "./pages/bulle.js";
import { renderDiagnostic } from "./pages/diagnostic.js";
import { renderSettings } from "./pages/reglages.js";
import { renderEngineer } from "./pages/ingenieur.js";
import { renderPerformance } from "./pages/performances.js";
import { renderProject } from "./pages/projet.js";
import { renderSecurity } from "./pages/securite.js";
import { renderWork } from "./pages/travail.js";

/** Chaque fenêtre de Jarvis charge la même interface et affiche la page demandée (?page=…). */
const root = document.getElementById("root")!;
const page = new URLSearchParams(location.search).get("page") ?? "accueil";
document.body.dataset.page = page;
if (page !== "bulle") startBackground();

switch (page) {
  case "bulle":
    renderBubble(root);
    break;
  case "ingenieur":
    renderEngineer(root);
    break;
  case "travail":
    renderWork(root);
    break;
  case "code":
    renderProject(root, "code");
    break;
  case "rd":
    renderProject(root, "rd");
    break;
  case "securite":
    renderSecurity(root);
    break;
  case "performances":
    renderPerformance(root);
    break;
  case "diagnostic":
    renderDiagnostic(root);
    break;
  case "reglages":
    renderSettings(root);
    break;
  default:
    renderHome(root);
}
