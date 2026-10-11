import { z } from "zod";

// #region note
export const noteSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(120),
  body: z.string().max(10_000),
  // Starts at 1, grows by one per successful update.
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

// An owner holds at most this many notes, so a list is always one bounded page.
export const MAX_NOTES_PER_OWNER = 100;
// #endregion note

export const noteListSchema = z.object({ notes: z.array(noteSchema) });

export const healthSchema = z.object({ status: z.literal("ok"), stage: z.string(), db: z.string() });

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
