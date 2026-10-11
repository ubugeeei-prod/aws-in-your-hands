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

export const noteListSchema = z.object({ notes: z.array(noteSchema) });

export const healthSchema = z.object({ status: z.literal("ok"), stage: z.string() });

// #region error
export const errorCodes = ["invalid_request", "not_found", "payload_too_large", "internal"] as const;

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
