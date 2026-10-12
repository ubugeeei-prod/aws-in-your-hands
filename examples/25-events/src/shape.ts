import * as v from "valibot";

import { noteSchema } from "@aih/example-05-dynamodb/src/contract.ts";
import { inspectionSchema } from "@aih/example-08-async/src/inspection.ts";

import { type DomainEvent, SCHEMA_VERSION } from "./contract.ts";

// #region record
// DynamoDB's own notation: every value wrapped in its type. Only the types
// this table's notes and inspection records use are read.
const attributeSchema = v.union([
  v.strictObject({ S: v.string() }),
  v.strictObject({ N: v.string() }),
  v.strictObject({ BOOL: v.boolean() }),
  v.strictObject({ NULL: v.literal(true) }),
]);
const imageSchema = v.record(v.string(), attributeSchema);

export const streamRecordSchema = v.object({
  eventID: v.string(),
  eventName: v.picklist(["INSERT", "MODIFY", "REMOVE"]),
  dynamodb: v.object({
    // Seconds since the epoch, when DynamoDB applied the change.
    ApproximateCreationDateTime: v.pipe(v.number(), v.finite(), v.minValue(0)),
    Keys: v.object({ pk: v.object({ S: v.string() }), sk: v.object({ S: v.string() }) }),
    NewImage: v.optional(imageSchema),
    OldImage: v.optional(imageSchema),
  }),
});
export type StreamRecord = v.InferOutput<typeof streamRecordSchema>;

function plain(image: v.InferOutput<typeof imageSchema>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(image).map(([name, value]) => {
      if ("S" in value) {
        return [name, value.S];
      }
      if ("N" in value) {
        return [name, Number(value.N)];
      }
      return [name, "BOOL" in value ? value.BOOL : null];
    }),
  );
}
// #endregion record

// #region shape
const OWNER = "OWNER#";

/**
 * One stream record as the fact it reports, or nothing when it reports none.
 * Throws on a record under a known prefix that does not read as what it should be.
 */
export function shape(input: unknown): DomainEvent | undefined {
  const record = v.parse(streamRecordSchema, input);
  const { pk, sk } = record.dynamodb.Keys;
  if (!pk.S.startsWith(OWNER)) {
    return undefined;
  }
  const owner = pk.S.slice(OWNER.length);
  const happened = new Date(record.dynamodb.ApproximateCreationDateTime * 1000).toISOString();

  if (sk.S.startsWith("NOTE#")) {
    const image =
      record.eventName === "REMOVE" ? record.dynamodb.OldImage : record.dynamodb.NewImage;
    const note = v.parse(noteSchema, plain(image ?? {}));
    const base = {
      version: SCHEMA_VERSION,
      owner,
      noteId: note.id,
      noteVersion: note.version,
    } as const;
    // The ID comes from the note and its version, never from the stream
    // record: however often this change is reported, it is one fact.
    const fact = `note:${owner}/${note.id}`;
    if (record.eventName === "REMOVE") {
      return { type: "NoteDeleted", id: `${fact}#deleted`, occurredAt: happened, ...base };
    }
    if (record.eventName === "INSERT") {
      return {
        type: "NoteCreated",
        id: `${fact}#${note.version}`,
        occurredAt: note.createdAt,
        ...base,
      };
    }
    const before = v.parse(noteSchema, plain(record.dynamodb.OldImage ?? {}));
    if (before.version === note.version) {
      // The item was written again without a new version. Nothing a consumer should hear of.
      return undefined;
    }
    return {
      type: "NoteUpdated",
      id: `${fact}#${note.version}`,
      occurredAt: note.updatedAt,
      ...base,
    };
  }

  if (sk.S.startsWith("INSPECTION#") && record.eventName !== "REMOVE") {
    const inspection = v.parse(inspectionSchema, plain(record.dynamodb.NewImage ?? {}));
    return {
      type: "AttachmentInspected",
      // Chapter 08's key for the same work: the object and its sequencer.
      id: `inspection:${owner}/${inspection.noteId}/${inspection.attachmentId}#${inspection.sequencer}`,
      version: SCHEMA_VERSION,
      occurredAt: inspection.inspectedAt,
      owner,
      noteId: inspection.noteId,
      attachmentId: inspection.attachmentId,
      verdict: inspection.verdict,
      ...(inspection.reason === undefined ? {} : { reason: inspection.reason }),
    };
  }
  return undefined;
}
// #endregion shape

// #region enrich
/** The pipe's enrichment step: a batch of stream records in, the events to publish out. */
export function enrich(records: unknown): DomainEvent[] {
  return v
    .parse(v.array(v.unknown()), records)
    .map(shape)
    .filter((event) => event !== undefined);
}
// #endregion enrich
