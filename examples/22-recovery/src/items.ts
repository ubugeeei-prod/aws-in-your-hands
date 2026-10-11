import { type Note, noteSchema } from "@aih/example-05-dynamodb/src/contract.ts";
import { type Attachment, attachmentSchema } from "@aih/example-07-uploads/api/src/contract.ts";
import { type Inspection, inspectionSchema } from "@aih/example-08-async/src/inspection.ts";
import { z } from "zod";

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
export interface TableReader {
  scan(): AsyncIterable<TableItem>;
}

// #region classify
export type Classified =
  | { kind: "note"; owner: string; note: Note }
  | { kind: "attachment"; owner: string; attachment: Attachment }
  | { kind: "inspection"; owner: string; inspection: Inspection }
  /** An item this app cannot read. Reported, never repaired. */
  | { kind: "unknown"; pk: string; sk: string; reason: string };

const keysSchema = z.looseObject({ pk: z.string(), sk: z.string() });

/** A restored table is outside data: every item is checked before it is believed. */
export function classify(item: unknown): Classified {
  const keys = keysSchema.safeParse(item);
  if (!keys.success) {
    return { kind: "unknown", pk: "", sk: "", reason: "no pk or sk" };
  }
  const { pk, sk, ...body } = keys.data;
  const unknown = (reason: string): Classified => ({ kind: "unknown", pk, sk, reason });
  if (!pk.startsWith("OWNER#")) {
    return unknown("not an owner partition");
  }
  const owner = pk.slice("OWNER#".length);

  if (sk.startsWith("NOTE#")) {
    const note = noteSchema.safeParse(body);
    if (!note.success || sk !== noteKey(note.data.id)) {
      return unknown("not a note this app wrote");
    }
    return { kind: "note", owner, note: note.data };
  }
  if (sk.startsWith("ATTACHMENT#")) {
    const attachment = attachmentSchema.safeParse(body);
    if (!attachment.success || sk !== attachmentKey(attachment.data.noteId, attachment.data.id)) {
      return unknown("not an attachment this app wrote");
    }
    return { kind: "attachment", owner, attachment: attachment.data };
  }
  if (sk.startsWith("INSPECTION#")) {
    const inspection = inspectionSchema.safeParse(body);
    if (!inspection.success || sk !== inspectionKey(inspection.data.noteId, inspection.data.attachmentId)) {
      return unknown("not an inspection this app wrote");
    }
    return { kind: "inspection", owner, inspection: inspection.data };
  }
  return unknown("unknown sort key prefix");
}
// #endregion classify
