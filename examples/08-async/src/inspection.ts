import { z } from "zod";

// #region record
// One record per object key: what the worker found in the bytes, and which
// event it was looking at when it found it.
export const inspectionSchema = z.object({
  noteId: z.string().min(1),
  attachmentId: z.string().min(1),
  /** Normalized (see sequencer.ts), so that two of them compare as strings. */
  sequencer: z.string().regex(/^[0-9A-F]{32}$/),
  eTag: z.string().min(1),
  size: z.number().int().nonnegative(),
  declaredType: z.string(),
  verdict: z.enum(["ok", "rejected"]),
  reason: z.enum(["not_an_image", "type_mismatch", "too_many_pixels"]).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  inspectedAt: z.iso.datetime(),
});
export type Inspection = z.infer<typeof inspectionSchema>;
// #endregion record

// #region repository
export interface InspectionRepository {
  /**
   * Writes the record unless one from the same event, or a later one, is
   * already there. Check and write are one step in the store.
   */
  putIfNewer(owner: string, inspection: Inspection): Promise<"written" | "not_newer">;
  /** Deletes the record unless it comes from an event later than `sequencer`. */
  deleteIfOlder(owner: string, noteId: string, attachmentId: string, sequencer: string): Promise<"deleted" | "kept">;
  get(owner: string, noteId: string, attachmentId: string): Promise<Inspection | undefined>;
}
// #endregion repository

export class InMemoryInspectionRepository implements InspectionRepository {
  readonly #records = new Map<string, Inspection>();

  #key = (owner: string, noteId: string, attachmentId: string): string => `${owner}/${noteId}/${attachmentId}`;

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
