import { JsonStore, newId } from "./store.js";

export interface Note {
  id: string;
  texte: string;
  tags: string[];
  creeLe: string;
  /** Date ISO à laquelle l'assistant doit te le rappeler. */
  rappelLe?: string;
  rappelEnvoye?: boolean;
}

export interface Memoire {
  id: string;
  fait: string;
  creeLe: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export class NotesRepository {
  private readonly notes: JsonStore<Note[]>;
  private readonly memoire: JsonStore<Memoire[]>;

  constructor(dataDir: string, private readonly now: () => Date = () => new Date()) {
    this.notes = new JsonStore(dataDir, "notes", () => []);
    this.memoire = new JsonStore(dataDir, "memoire", () => []);
  }

  add(texte: string, tags: string[] = [], rappelLe?: string): Note {
    const note: Note = {
      id: newId("note"),
      texte,
      tags: tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean),
      creeLe: this.now().toISOString(),
      ...(rappelLe ? { rappelLe: new Date(rappelLe).toISOString() } : {}),
    };
    this.notes.update((all) => [...all, note]);
    return note;
  }

  /** Recherche insensible aux accents et à la casse ; tous les mots doivent apparaître. */
  search(query: string, limit = 20): Note[] {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return this.notes
      .read()
      .filter((note) => {
        const haystack = normalize(`${note.texte} ${note.tags.join(" ")}`);
        return words.every((word) => haystack.includes(word));
      })
      .reverse()
      .slice(0, limit);
  }

  list(limit = 20): Note[] {
    return this.notes.read().reverse().slice(0, limit);
  }

  remove(id: string): boolean {
    let removed = false;
    this.notes.update((all) =>
      all.filter((note) => {
        if (note.id === id) removed = true;
        return note.id !== id;
      }),
    );
    return removed;
  }

  /** Rappels arrivés à échéance et pas encore envoyés. */
  dueReminders(): Note[] {
    const now = this.now().getTime();
    return this.notes
      .read()
      .filter((note) => note.rappelLe && !note.rappelEnvoye && new Date(note.rappelLe).getTime() <= now);
  }

  markReminderSent(id: string): void {
    this.notes.update((all) => all.map((note) => (note.id === id ? { ...note, rappelEnvoye: true } : note)));
  }

  remember(fait: string): Memoire {
    const entry: Memoire = { id: newId("mem"), fait, creeLe: this.now().toISOString() };
    this.memoire.update((all) => [...all, entry]);
    return entry;
  }

  forget(id: string): boolean {
    const before = this.memoire.read().length;
    return this.memoire.update((all) => all.filter((entry) => entry.id !== id)).length < before;
  }

  memories(): Memoire[] {
    return this.memoire.read();
  }
}
