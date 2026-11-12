import { describe, expect, it } from "vitest";
import { focusWindowScript, hotkeyScript, keyCode, mouseScript, openScript, psString, typeScript } from "../src/main/pc.js";

describe("contrôle du PC (scripts PowerShell)", () => {
  it("échappe les apostrophes", () => {
    expect(psString("l'appli d'Alex")).toBe("'l''appli d''Alex'");
    expect(openScript("C:\\Program Files\\L'app\\app.exe")).toBe("Start-Process -FilePath 'C:\\Program Files\\L''app\\app.exe'");
  });

  it("traduit les raccourcis clavier", () => {
    expect(keyCode("ctrl")).toBe(0x11);
    expect(keyCode("F5")).toBe(0x74);
    expect(keyCode("a")).toBe(0x41);
    expect(() => keyCode("touche-magique")).toThrow(/inconnue/);
    const script = hotkeyScript("ctrl+shift+esc");
    expect(script.indexOf("keybd_event(17,0,0")).toBeLessThan(script.indexOf("keybd_event(27,0,0"));
    expect(script.indexOf("keybd_event(27,0,2")).toBeLessThan(script.indexOf("keybd_event(17,0,2"));
  });

  it("clique aux bonnes coordonnées", () => {
    const script = mouseScript("double_clic", 812.4, 300.6);
    expect(script).toContain("SetCursorPos(812, 301)");
    expect(script.match(/mouse_event\(2,/g)).toHaveLength(2);
    expect(mouseScript("glisser", 10, 10, 200, 300)).toContain("SetCursorPos(200, 300)");
  });

  it("tape le texte par le presse-papiers et le restaure", () => {
    const script = typeScript("Réunion d'équipe à 14 h");
    expect(script).toContain("Set-Clipboard -Value 'Réunion d''équipe à 14 h'");
    expect(script).toContain("Set-Clipboard -Value $old");
  });

  it("met une fenêtre au premier plan par son titre", () => {
    expect(focusWindowScript("Excel")).toContain("-like '*Excel*'");
  });
});
