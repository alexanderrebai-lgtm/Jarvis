import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Petit stockage JSON sur disque : un fichier par collection, écrit de façon
 * atomique (fichier temporaire puis renommage) pour ne jamais le corrompre.
 */
export class JsonStore<T> {
  private readonly file: string;

  constructor(dir: string, name: string, private readonly fallback: () => T) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `${name}.json`);
  }

  read(): T {
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as T;
    } catch {
      return this.fallback();
    }
  }

  write(value: T): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2));
    renameSync(tmp, this.file);
  }

  update(change: (value: T) => T): T {
    const next = change(this.read());
    this.write(next);
    return next;
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
