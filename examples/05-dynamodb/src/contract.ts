import { z } from "zod";

// #region note
export const noteSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  body: z.string().max(10_000),
  // Starts at 1, grows by one per successful update. Callers send back the one they last saw.
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Note = z.infer<typeof noteSchema>;

export const createNoteSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().max(10_000).default(""),
});
export type CreateNote = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = createNoteSchema.extend({
  expectedVersion: z.number().int().positive(),
});
export type UpdateNote = z.infer<typeof updateNoteSchema>;

// Anyone can POST, so an owner's notes stop here instead of growing with the bill.
export const MAX_NOTES_PER_OWNER = 100;
// #endregion note

// #region list
// What a list view shows. The body comes from GET /notes/:id.
export const noteSummarySchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  // Enough to tell whether a note changed since it was listed.
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type NoteSummary = z.infer<typeof noteSummarySchema>;

export const toNoteSummary = ({ id, title, version, createdAt, updatedAt }: Note): NoteSummary => ({
  id,
  title,
  version,
  createdAt,
  updatedAt,
});

// One page is what one screen shows. It also bounds the largest list response.
export const MAX_PAGE_SIZE = 20;

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(MAX_PAGE_SIZE),
  cursor: z.string().min(1).max(512).optional(),
});

// Strict, so a body or a page past the maximum fails the check instead of passing through.
export const noteListSchema = z.strictObject({
  notes: z.array(noteSummarySchema).max(MAX_PAGE_SIZE),
  // Opaque to the caller. null means there is nothing after this page.
  nextCursor: z.string().nullable(),
});
export type NoteList = z.infer<typeof noteListSchema>;
// #endregion list

export const healthSchema = z.object({
  status: z.literal("ok"),
  stage: z.string(),
  store: z.string(),
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

export const errorSchema = z.object({
  error: z.object({
    code: z.enum(errorCodes),
    message: z.string(),
    requestId: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    // Sent with `conflict`: the note as it is stored now.
    current: noteSchema.optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorSchema>;
// #endregion error
