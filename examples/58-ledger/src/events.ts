import * as v from "valibot";

// #region event
const id = v.pipe(v.string(), v.minLength(1), v.maxLength(128));

// What the notes app records. A hash of the body, never the body: an entry
// cannot be deleted later, so nothing a user may ask to have erased goes in.
export const noteEventSchema = v.strictObject({
  type: v.picklist(["note.created", "note.updated", "note.deleted"]),
  noteId: id,
  actor: id,
  version: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  bodySha256: v.optional(v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/))),
});
export type NoteEvent = v.InferOutput<typeof noteEventSchema>;

/** The text the ledger stores and hashes. */
export const encodeEvent = (event: v.InferInput<typeof noteEventSchema>): string =>
  JSON.stringify(v.parse(noteEventSchema, event));
// #endregion event
