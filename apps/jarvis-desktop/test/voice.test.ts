import { describe, expect, it } from "vitest";
import { cleanTranscript, SentenceSplitter, speakable } from "../src/main/voice.js";

describe("voix", () => {
  it("prépare un texte à lire à voix haute", () => {
    expect(speakable("**C'est fait** ✅ Voir [le site](https://exemple.fr) ou https://a.b/c")).toBe("C'est fait Voir le site ou le lien affiché");
    expect(speakable("Voici :\n```python\nprint(1)\n```")).toBe("Voici : (le code est affiché à l'écran)");
  });

  it("découpe la réponse en phrases au fil de l'eau", () => {
    const splitter = new SentenceSplitter();
    expect(splitter.push("Bonjour Alex. Il fait 7")).toEqual(["Bonjour Alex."]);
    expect(splitter.push(",5 degrés dehors ! Je")).toEqual(["Il fait 7,5 degrés dehors !"]);
    expect(splitter.push(" ferme les volets")).toEqual([]);
    expect(splitter.flush()).toEqual(["Je ferme les volets"]);
  });

  it("écarte les phrases inventées par Whisper sur du silence", () => {
    expect(cleanTranscript(" Sous-titrage ST' 501 ")).toBe("");
    expect(cleanTranscript("[Musique]")).toBe("");
    expect(cleanTranscript(" Jarvis, allume la lumière. ")).toBe("Jarvis, allume la lumière.");
  });
});
