import * as v from "valibot";

import { type Note, noteSchema } from "@aih/example-05-dynamodb/src/contract.ts";
import {
  decodeCursor,
  encodeCursor,
  type NoteRepository,
} from "@aih/example-05-dynamodb/src/repository.ts";

import type { Replica } from "./global-table.ts";

const key = (owner: string, id: string): string => `OWNER#${owner}|NOTE#${id}`;

const toNote = (item: unknown): Note => v.parse(noteSchema, item);

// #region repository
/**
 * Chapter 05's repository, on the copy of the table in one Region. The checks
 * are the same ones `DynamoDbNoteRepository` sends as condition expressions.
 */
export class ReplicaNoteRepository implements NoteRepository {
  readonly #replica: Replica;

  constructor(replica: Replica) {
    this.#replica = replica;
  }

  async create(owner: string, note: Note) {
    const result = this.#replica.put(key(owner, note.id), note, (current) => current === undefined);
    return result === "written" ? ("created" as const) : ("already_exists" as const);
  }

  async get(owner: string, id: string) {
    const item = this.#replica.get(key(owner, id));
    return item === undefined ? undefined : toNote(item);
  }

  async list(owner: string, options: { limit: number; cursor?: string | undefined }) {
    const after = options.cursor === undefined ? undefined : decodeCursor(options.cursor);
    const mine = this.#replica
      .query(`OWNER#${owner}|NOTE#`)
      .map(toNote)
      .toReversed()
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
    const noteKey = key(owner, id);
    const current = this.#replica.get(noteKey);
    if (current === undefined) {
      return { status: "not_found" as const };
    }
    const note: Note = {
      ...toNote(current),
      title: change.title,
      body: change.body,
      version: change.expectedVersion + 1,
      updatedAt: change.updatedAt,
    };
    // "version = :expected", evaluated where the write lands and nowhere else.
    const result = this.#replica.put(
      noteKey,
      note,
      (stored) => stored?.["version"] === change.expectedVersion,
    );
    return result === "written"
      ? { status: "updated" as const, note }
      : { status: "conflict" as const, current: toNote(current) };
  }

  async delete(owner: string, id: string) {
    return this.#replica.delete(key(owner, id), (current) => current !== undefined) === "written";
  }
}
// #endregion repository
