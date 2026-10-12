import type { Note } from "./contract.ts";
import { decodeCursor, encodeCursor, type NoteRepository } from "./repository.ts";

// One process, no concurrency: this says nothing about DynamoDB under simultaneous writers.
export class InMemoryNoteRepository implements NoteRepository {
  readonly #notes = new Map<string, Note>();
  readonly #maxNotesPerOwner: number;

  /** Without a limit, an owner's notes are not counted. */
  constructor(maxNotesPerOwner: number = Number.POSITIVE_INFINITY) {
    this.#maxNotesPerOwner = maxNotesPerOwner;
  }

  #key = (owner: string, id: string): string => `${owner}/${id}`;

  async create(owner: string, note: Note) {
    const key = this.#key(owner, note.id);
    if (this.#notes.has(key)) {
      return "already_exists" as const;
    }
    const held = [...this.#notes.keys()].filter((other) => other.startsWith(`${owner}/`)).length;
    if (held >= this.#maxNotesPerOwner) {
      return "quota_exceeded" as const;
    }
    this.#notes.set(key, note);
    return "created" as const;
  }

  async get(owner: string, id: string) {
    return this.#notes.get(this.#key(owner, id));
  }

  async list(owner: string, options: { limit: number; cursor?: string | undefined }) {
    const after = options.cursor === undefined ? undefined : decodeCursor(options.cursor);
    const mine = [...this.#notes.entries()]
      .filter(([key]) => key.startsWith(`${owner}/`))
      .map(([, note]) => note)
      .toSorted((a, b) => (a.id < b.id ? 1 : -1))
      .filter((note) => after === undefined || note.id < after);
    const notes = mine.slice(0, options.limit);
    const last = notes.at(-1);
    return {
      notes,
      nextCursor: mine.length > options.limit && last !== undefined ? encodeCursor(last.id) : null,
    };
  }

  async update(
    owner: string,
    id: string,
    change: { title: string; body: string; expectedVersion: number; updatedAt: string },
  ) {
    const key = this.#key(owner, id);
    const current = this.#notes.get(key);
    if (current === undefined) {
      return { status: "not_found" as const };
    }
    if (current.version !== change.expectedVersion) {
      return { status: "conflict" as const, current };
    }
    const note: Note = {
      ...current,
      title: change.title,
      body: change.body,
      version: current.version + 1,
      updatedAt: change.updatedAt,
    };
    this.#notes.set(key, note);
    return { status: "updated" as const, note };
  }

  async delete(owner: string, id: string) {
    return this.#notes.delete(this.#key(owner, id));
  }
}
