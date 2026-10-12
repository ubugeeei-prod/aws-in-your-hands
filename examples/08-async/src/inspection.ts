import * as v from "valibot";

import { utcTimestamp } from "@aih/example-04-http-api/src/timestamp.ts";

// #region record
// One record per object key: what the worker found in the bytes, and which
// event it was looking at when it found it.
export const inspectionSchema = v.object({
  noteId: v.pipe(v.string(), v.minLength(1)),
  attachmentId: v.pipe(v.string(), v.minLength(1)),
  /** Normalized (see sequencer.ts), so that two of them compare as strings. */
  sequencer: v.pipe(v.string(), v.regex(/^[0-9A-F]{32}$/)),
  eTag: v.pipe(v.string(), v.minLength(1)),
  // v.safeInteger(), not v.integer(): 1e300 is an integer too, and no object has that many bytes.
  size: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  declaredType: v.string(),
  verdict: v.picklist(["ok", "rejected"]),
  reason: v.optional(v.picklist(["not_an_image", "type_mismatch", "too_many_pixels"])),
  width: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
  height: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(1))),
  inspectedAt: utcTimestamp,
});
export type Inspection = v.InferOutput<typeof inspectionSchema>;
// #endregion record

// #region repository
export type InspectionRepository = {
  /**
   * Writes the record unless one from the same event, or a later one, is
   * already there. Check and write are one step in the store.
   */
  putIfNewer(owner: string, inspection: Inspection): Promise<"written" | "not_newer">;
  /** Deletes the record unless it comes from an event later than `sequencer`. */
  deleteIfOlder(
    owner: string,
    noteId: string,
    attachmentId: string,
    sequencer: string,
  ): Promise<"deleted" | "kept">;
  get(owner: string, noteId: string, attachmentId: string): Promise<Inspection | undefined>;
};
// #endregion repository

export class InMemoryInspectionRepository implements InspectionRepository {
  readonly #records = new Map<string, Inspection>();

  #key = (owner: string, noteId: string, attachmentId: string): string =>
    `${owner}/${noteId}/${attachmentId}`;

  async putIfNewer(owner: string, inspection: Inspection) {
    const key = this.#key(owner, inspection.noteId, inspection.attachmentId);
    const existing = this.#records.get(key);
    // No `await` between the read and the write: one step, as the condition is in DynamoDB.
    if (existing !== undefined && existing.sequencer >= inspection.sequencer) {
      return "not_newer" as const;
    }
    this.#records.set(key, inspection);
    return "written" as const;
  }

  async deleteIfOlder(owner: string, noteId: string, attachmentId: string, sequencer: string) {
    const key = this.#key(owner, noteId, attachmentId);
    const existing = this.#records.get(key);
    if (existing !== undefined && existing.sequencer >= sequencer) {
      return "kept" as const;
    }
    this.#records.delete(key);
    return "deleted" as const;
  }

  async get(owner: string, noteId: string, attachmentId: string) {
    return this.#records.get(this.#key(owner, noteId, attachmentId));
  }

  /** For tests and the development server. */
  all(): Inspection[] {
    return [...this.#records.values()];
  }
}
