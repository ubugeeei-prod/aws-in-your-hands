import { z } from "zod";

import { type Note, noteSchema } from "@aih/example-04-http-api/src/contract.ts";
import type { NoteRepository } from "@aih/example-04-http-api/src/notes.ts";

// #region formats
/** How one version of the app reads and writes a stored note. */
export type RecordFormat = z.ZodType<Note>;

export const formats = {
  /** Version 1. Fields it does not know are dropped on read, not rejected. */
  v1: noteSchema,
  /** Version 2 adds a field. Records written before it lack the field, so reading supplies a default. */
  v2: noteSchema.extend({ pinned: z.boolean().default(false) }),

  /** A version 2 that insists on its new field. It cannot read what version 1 wrote. */
  v2Required: noteSchema.extend({ pinned: z.boolean() }),
  /** A version 1 that rejects fields it does not know. It cannot read what version 2 writes. */
  v1Strict: z.strictObject(noteSchema.shape),
} satisfies Record<string, RecordFormat>;
// #endregion formats

// #region store
/**
 * Stands in for a table: JSON text that outlives every task. Each task reads
 * and writes it through the format its own build was compiled with.
 */
export class SharedRecords {
  readonly #records = new Map<string, string>();

  repository(format: RecordFormat): NoteRepository {
    const read = (text: string): Note => format.parse(JSON.parse(text));
    return {
      list: async () =>
        [...this.#records.values()]
          .map(read)
          .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)),
      get: async (id) => {
        const text = this.#records.get(id);
        return text === undefined ? undefined : read(text);
      },
      put: async (note) => void this.#records.set(note.id, JSON.stringify(format.parse(note))),
      delete: async (id) => this.#records.delete(id),
    };
  }

  /** The stored text, for tests that need to see what a version left behind. */
  raw(id: string): unknown {
    const text = this.#records.get(id);
    return text === undefined ? undefined : JSON.parse(text);
  }
}
// #endregion store
