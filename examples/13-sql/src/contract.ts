import * as v from "valibot";

import { utcTimestamp } from "@aih/example-04-http-api/src/timestamp.ts";

// #region note
export const noteSchema = v.object({
  id: v.pipe(v.string(), v.uuid()),
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  body: v.pipe(v.string(), v.maxLength(10_000)),
  // Starts at 1, grows by one per successful update.
  version: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  createdAt: utcTimestamp,
  updatedAt: utcTimestamp,
});
export type Note = v.InferOutput<typeof noteSchema>;

export const createNoteSchema = v.object({
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  body: v.optional(v.pipe(v.string(), v.maxLength(10_000)), ""),
});
export type CreateNote = v.InferOutput<typeof createNoteSchema>;

export const updateNoteSchema = v.object({
  ...createNoteSchema.entries,
  expectedVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
});
export type UpdateNote = v.InferOutput<typeof updateNoteSchema>;

// Anyone can POST, so an owner's notes stop here instead of growing with the bill.
export const MAX_NOTES_PER_OWNER = 100;
// #endregion note

// #region list
// What a list view shows. The body comes from GET /notes/:id.
export const noteSummarySchema = v.strictObject({
  id: v.pipe(v.string(), v.uuid()),
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  version: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  createdAt: utcTimestamp,
  updatedAt: utcTimestamp,
});
export type NoteSummary = v.InferOutput<typeof noteSummarySchema>;

// A list answers with the newest notes, up to this many. It bounds the response, not the store.
export const MAX_LISTED_NOTES = 20;

// Strict, so a body or a 21st note fails the check instead of passing through.
export const noteListSchema = v.strictObject({
  notes: v.pipe(v.array(noteSummarySchema), v.maxLength(MAX_LISTED_NOTES)),
});
// #endregion list

export const healthSchema = v.object({
  status: v.literal("ok"),
  stage: v.string(),
  db: v.string(),
});

// #region error
export const errorCodes = [
  "invalid_request",
  "not_found",
  // The note changed since the caller read it.
  "conflict",
  "quota_exceeded",
  // The database kept reporting conflicts. Nothing was written; try again.
  "busy",
  "payload_too_large",
  "internal",
] as const;

export const errorSchema = v.object({
  error: v.object({
    code: v.picklist(errorCodes),
    message: v.string(),
    requestId: v.string(),
    issues: v.optional(v.array(v.object({ path: v.string(), message: v.string() }))),
    // Sent with `conflict`: the note as it is stored now.
    current: v.optional(noteSchema),
  }),
});
export type ErrorBody = v.InferOutput<typeof errorSchema>;
// #endregion error
