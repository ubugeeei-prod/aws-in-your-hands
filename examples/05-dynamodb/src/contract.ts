import * as v from "valibot";

import { utcTimestamp } from "@aih/example-04-http-api/src/timestamp.ts";

// #region note
export const noteSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  body: v.pipe(v.string(), v.maxLength(10_000)),
  // Starts at 1, grows by one per successful update. Callers send back the one they last saw.
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
  id: v.pipe(v.string(), v.minLength(1)),
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  // Enough to tell whether a note changed since it was listed.
  version: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  createdAt: utcTimestamp,
  updatedAt: utcTimestamp,
});
export type NoteSummary = v.InferOutput<typeof noteSummarySchema>;

export const toNoteSummary = ({ id, title, version, createdAt, updatedAt }: Note): NoteSummary => ({
  id,
  title,
  version,
  createdAt,
  updatedAt,
});

// One page is what one screen shows. It also bounds the largest list response.
export const MAX_PAGE_SIZE = 20;

export const listQuerySchema = v.object({
  // A query string is text. "2" becomes 2; "two" becomes NaN, which v.number() refuses.
  limit: v.optional(
    v.pipe(
      v.string(),
      v.transform(Number),
      v.number(),
      v.safeInteger(),
      v.minValue(1),
      v.maxValue(MAX_PAGE_SIZE),
    ),
    String(MAX_PAGE_SIZE),
  ),
  cursor: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(512))),
});

// Strict, so a body or a page past the maximum fails the check instead of passing through.
export const noteListSchema = v.strictObject({
  notes: v.pipe(v.array(noteSummarySchema), v.maxLength(MAX_PAGE_SIZE)),
  // Opaque to the caller. null means there is nothing after this page.
  nextCursor: v.nullable(v.string()),
});
export type NoteList = v.InferOutput<typeof noteListSchema>;
// #endregion list

export const healthSchema = v.object({
  status: v.literal("ok"),
  stage: v.string(),
  store: v.string(),
});

// #region error
export const errorCodes = [
  "invalid_request",
  "not_found",
  "conflict",
  // The owner already holds MAX_NOTES_PER_OWNER notes.
  "quota_exceeded",
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
