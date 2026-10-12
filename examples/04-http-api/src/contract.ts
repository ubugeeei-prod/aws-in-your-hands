import * as v from "valibot";

// #region note
export const noteSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  body: v.pipe(v.string(), v.maxLength(10_000)),
  createdAt: v.pipe(v.string(), v.isoTimestamp()),
});
export type Note = v.InferOutput<typeof noteSchema>;

export const createNoteSchema = v.object({
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  body: v.optional(v.pipe(v.string(), v.maxLength(10_000)), ""),
});
export type CreateNote = v.InferOutput<typeof createNoteSchema>;
// #endregion note

// #region list
// What a list view shows. The body comes from GET /notes/:id.
export const noteSummarySchema = v.strictObject({
  id: v.pipe(v.string(), v.minLength(1)),
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  createdAt: v.pipe(v.string(), v.isoTimestamp()),
});
export type NoteSummary = v.InferOutput<typeof noteSummarySchema>;

// A list answers with the newest notes, up to this many. It bounds the response, not the store.
export const MAX_LISTED_NOTES = 20;

// Strict, so a body or a 21st note fails the check instead of passing through.
export const noteListSchema = v.strictObject({
  notes: v.pipe(v.array(noteSummarySchema), v.maxLength(MAX_LISTED_NOTES)),
});
// #endregion list

export const healthSchema = v.object({ status: v.literal("ok"), stage: v.string() });

// #region error
export const errorCodes = [
  "invalid_request",
  "not_found",
  // The store is full. Delete a note, then try again.
  "quota_exceeded",
  "payload_too_large",
  "internal",
] as const;

export const errorSchema = v.object({
  error: v.object({
    code: v.picklist(errorCodes),
    message: v.string(),
    // Search the logs for this.
    requestId: v.string(),
    issues: v.optional(v.array(v.object({ path: v.string(), message: v.string() }))),
  }),
});
export type ErrorBody = v.InferOutput<typeof errorSchema>;
// #endregion error
