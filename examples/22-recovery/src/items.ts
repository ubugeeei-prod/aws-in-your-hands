import * as v from "valibot";

import { type Note, noteSchema } from "@aih/example-05-dynamodb/src/contract.ts";
import { type Attachment, attachmentSchema } from "@aih/example-07-uploads/api/src/contract.ts";
import { type Inspection, inspectionSchema } from "@aih/example-08-async/src/inspection.ts";

// #region keys
// The key formats of chapters 05, 07, and 08, which those chapters keep
// private. test/items.test.ts fails if any of the three repositories changes its keys.
export const ownerKey = (owner: string): string => `OWNER#${owner}`;
export const noteKey = (noteId: string): string => `NOTE#${noteId}`;
export const attachmentKey = (noteId: string, id: string): string => `ATTACHMENT#${noteId}#${id}`;
export const inspectionKey = (noteId: string, id: string): string => `INSPECTION#${noteId}#${id}`;
// #endregion keys

export type TableItem = Record<string, unknown>;

/** Everything a full read of the table can yield. */
export type TableReader = {
  scan(): AsyncIterable<TableItem>;
};

// #region classify
export type Classified =
  | { kind: "note"; owner: string; note: Note }
  | { kind: "attachment"; owner: string; attachment: Attachment }
  | { kind: "inspection"; owner: string; inspection: Inspection }
  /** A running count the app keeps for a limit: notes per owner (05), upload permits per day (07). */
  | { kind: "counter"; owner: string; sk: string }
  /** An item this app cannot read. Reported, never repaired. */
  | { kind: "unknown"; pk: string; sk: string; reason: string };

const keysSchema = v.looseObject({ pk: v.string(), sk: v.string() });

/** A restored table is outside data: every item is checked before it is believed. */
export function classify(item: unknown): Classified {
  const keys = v.safeParse(keysSchema, item);
  if (!keys.success) {
    return { kind: "unknown", pk: "", sk: "", reason: "no pk or sk" };
  }
  const { pk, sk, ...body } = keys.output;
  const unknown = (reason: string): Classified => ({ kind: "unknown", pk, sk, reason });
  if (!pk.startsWith("OWNER#")) {
    return unknown("not an owner partition");
  }
  const owner = pk.slice("OWNER#".length);

  if (sk.startsWith("NOTE#")) {
    const note = v.safeParse(noteSchema, body);
    if (!note.success || sk !== noteKey(note.output.id)) {
      return unknown("not a note this app wrote");
    }
    return { kind: "note", owner, note: note.output };
  }
  if (sk.startsWith("ATTACHMENT#")) {
    const attachment = v.safeParse(attachmentSchema, body);
    if (
      !attachment.success ||
      sk !== attachmentKey(attachment.output.noteId, attachment.output.id)
    ) {
      return unknown("not an attachment this app wrote");
    }
    return { kind: "attachment", owner, attachment: attachment.output };
  }
  if (sk.startsWith("INSPECTION#")) {
    const inspection = v.safeParse(inspectionSchema, body);
    if (
      !inspection.success ||
      sk !== inspectionKey(inspection.output.noteId, inspection.output.attachmentId)
    ) {
      return unknown("not an inspection this app wrote");
    }
    return { kind: "inspection", owner, inspection: inspection.output };
  }
  // Counts are not data to recover: after a restore they may be off by a few, and the app only reads them as limits.
  if (sk === "QUOTA" || sk.startsWith("PERMITS#")) {
    return { kind: "counter", owner, sk };
  }
  return unknown("unknown sort key prefix");
}
// #endregion classify
