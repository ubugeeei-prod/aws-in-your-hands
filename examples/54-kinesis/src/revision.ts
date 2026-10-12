import * as v from "valibot";

// #region revision
// One change to one note. `version` is the note's own counter from chapter 05:
// every successful write of a note has the next number, so (noteId, version)
// names a revision whoever sends it, and however often.
export const revisionSchema = v.object({
  noteId: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  owner: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
  version: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  kind: v.picklist(["created", "edited", "deleted"]),
  at: v.pipe(v.string(), v.isoTimestamp()),
});
export type Revision = v.InferOutput<typeof revisionSchema>;

/** Every revision of a note goes to the same shard, so the shard keeps their order. */
export const partitionKeyOf = (revision: Revision): string => revision.noteId;
// #endregion revision

// #region codec
/** A record no retry can fix: not JSON, not a revision, or filed under another note's key. */
export class PoisonRecordError extends Error {
  override readonly name = "PoisonRecordError";
}

export const encode = (revision: Revision): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(revision));

export function decode(partitionKey: string, data: Uint8Array): Revision {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    throw new PoisonRecordError("the record's data is not JSON");
  }
  const result = v.safeParse(revisionSchema, json);
  if (!result.success) {
    const where = result.issues.map((issue) => v.getDotPath(issue) ?? "").join(", ");
    throw new PoisonRecordError(`the record is not a revision (${where})`);
  }
  // Order is kept per partition key. A revision under another key has no order to rely on.
  if (partitionKey !== partitionKeyOf(result.output)) {
    throw new PoisonRecordError("the partition key is not the revision's note");
  }
  return result.output;
}
// #endregion codec
