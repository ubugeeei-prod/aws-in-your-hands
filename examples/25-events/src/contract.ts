import * as v from "valibot";

import { utcTimestamp } from "@aih/example-04-http-api/src/timestamp.ts";

// #region envelope
/** What every rule on the bus matches first: who says so. */
export const SOURCE = "aih.notes";

/** The shape of `detail`. A change that an existing consumer cannot read gets the next number. */
export const SCHEMA_VERSION = 1;

const id = v.pipe(v.string(), v.minLength(1), v.maxLength(256));

// Carried by every event. No title and no body: an event is kept in the
// archive long after the note it speaks of is deleted.
const common = {
  /** Names the fact, not the delivery: the same change always gets the same ID. */
  id,
  version: v.literal(SCHEMA_VERSION),
  occurredAt: utcTimestamp,
  owner: id,
  noteId: id,
};
// #endregion envelope

// #region events
const noteVersion = v.pipe(v.number(), v.safeInteger(), v.minValue(1));

export const noteCreatedSchema = v.object({
  type: v.literal("NoteCreated"),
  ...common,
  noteVersion,
});
export const noteUpdatedSchema = v.object({
  type: v.literal("NoteUpdated"),
  ...common,
  noteVersion,
});
export const noteDeletedSchema = v.object({
  type: v.literal("NoteDeleted"),
  ...common,
  /** The version the note had when it was deleted. */
  noteVersion,
});
export const attachmentInspectedSchema = v.pipe(
  v.object({
    type: v.literal("AttachmentInspected"),
    ...common,
    attachmentId: id,
    verdict: v.picklist(["ok", "rejected"]),
    reason: v.optional(v.picklist(["not_an_image", "type_mismatch", "too_many_pixels"])),
  }),
  // The notice built from a rejection quotes the reason, so there has to be one.
  v.check(
    (event) => event.verdict !== "rejected" || event.reason !== undefined,
    "A rejected attachment carries a reason.",
  ),
);

// v.object, not v.strictObject: a consumer written today keeps reading an
// event that gains a field tomorrow.
export const noteEventSchema = v.variant("type", [
  noteCreatedSchema,
  noteUpdatedSchema,
  noteDeletedSchema,
]);
export type NoteEvent = v.InferOutput<typeof noteEventSchema>;

export const domainEventSchema = v.union([noteEventSchema, attachmentInspectedSchema]);
export type DomainEvent = v.InferOutput<typeof domainEventSchema>;
export type AttachmentInspected = v.InferOutput<typeof attachmentInspectedSchema>;
// #endregion events

// #region bus-event
// What a rule's target receives when no input transformer is set: EventBridge's
// own fields around `detail`. `replay-name` is there only on a replayed event.
export const busEventSchema = v.object({
  id: v.string(),
  source: v.string(),
  "detail-type": v.string(),
  time: v.string(),
  detail: v.unknown(),
  "replay-name": v.optional(v.string()),
});
export type BusEvent = v.InferOutput<typeof busEventSchema>;
// #endregion bus-event
