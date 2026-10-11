import { z } from "zod";

// The contract between the API and every caller. The handler validates
// requests with these schemas, the client validates responses with them, and
// both get their TypeScript types from them. There is no second definition to
// drift from this one.

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
// One error shape for every failure, so a caller can branch on `code` without
// parsing prose. `requestId` is the value to search the logs for.
export const errorCodes = ["invalid_request", "not_found", "payload_too_large", "internal"] as const;

export const errorSchema = z.object({
  error: z.object({
    code: z.enum(errorCodes),
    message: z.string(),
    requestId: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorSchema>;
// #endregion error
