import { z } from "zod";

// #region note
export const noteSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  body: z.string().max(10_000),
  createdAt: z.iso.datetime(),
});
export type Note = z.infer<typeof noteSchema>;

export const createNoteSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().max(10_000).default(""),
});
export type CreateNote = z.infer<typeof createNoteSchema>;
// #endregion note

// #region list
// What a list view shows. The body comes from GET /notes/:id.
export const noteSummarySchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  createdAt: z.iso.datetime(),
});
export type NoteSummary = z.infer<typeof noteSummarySchema>;

// A list answers with the newest notes, up to this many. It bounds the response, not the store.
export const MAX_LISTED_NOTES = 20;

// Strict, so a body or a 21st note fails the check instead of passing through.
export const noteListSchema = z.strictObject({
  notes: z.array(noteSummarySchema).max(MAX_LISTED_NOTES),
});
// #endregion list

export const healthSchema = z.object({ status: z.literal("ok"), stage: z.string() });

// #region error
export const errorCodes = [
  "invalid_request",
  "not_found",
  // The store is full. Delete a note, then try again.
  "quota_exceeded",
  "payload_too_large",
  "internal",
] as const;

export const errorSchema = z.object({
  error: z.object({
    code: z.enum(errorCodes),
    message: z.string(),
    // Search the logs for this.
    requestId: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorSchema>;
// #endregion error
