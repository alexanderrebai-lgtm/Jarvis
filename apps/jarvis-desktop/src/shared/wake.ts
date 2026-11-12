/**
 * Mot de réveil : la reconnaissance vocale transcrit chaque phrase entendue, et
 * Jarvis ne réagit que si elle commence par (ou contient) son nom. Après une
 * réponse, il reste à l'écoute quelques secondes pour une suite sans le nom.
 */

const WAKE_VARIANTS = ["jarvis", "jarviss", "jarvisse", "djarvis", "jarvice", "jarviz", "jervis", "charvis", "javis", "jarbis"];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface WakeResult {
  awake: boolean;
  /** La demande, sans le nom ni la ponctuation autour. */
  command: string;
}

export function detectWake(transcript: string, alreadyListening: boolean): WakeResult {
  const original = transcript.trim();
  const words = original.split(/\s+/).filter(Boolean);
  const index = words.findIndex((w) => WAKE_VARIANTS.includes(normalize(w).replace(/'/g, "")));
  if (index === -1) {
    return alreadyListening && original.length > 0 ? { awake: true, command: original } : { awake: false, command: "" };
  }
  // « Jarvis, allume… » : la demande suit le nom. « Allume la lumière, Jarvis » : elle le précède.
  const after = words.slice(index + 1).join(" ");
  const before = words
    .slice(0, index)
    .filter((w, i) => !(i === index - 1 && INTERJECTIONS.has(normalize(w))))
    .join(" ");
  const raw = index <= 2 && after ? after : [before, after].filter(Boolean).join(" ");
  const command = raw.replace(/^[\s,.;:!?-]+|[\s,;:-]+$/g, "").trim();
  return { awake: true, command };
}

const INTERJECTIONS = new Set(["hey", "he", "eh", "ok", "okay", "dis", "salut", "bonjour", "allez"]);

/** Fenêtre de conversation : après une réponse, pas besoin de redire « Jarvis ». */
export class ConversationWindow {
  private until = 0;

  constructor(private readonly durationMs = 20_000, private readonly now: () => number = Date.now) {}

  open(): void {
    this.until = this.now() + this.durationMs;
  }

  close(): void {
    this.until = 0;
  }

  get active(): boolean {
    return this.now() < this.until;
  }
}
