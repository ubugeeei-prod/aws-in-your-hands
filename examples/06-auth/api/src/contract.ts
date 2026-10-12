import { z } from "zod";

import {
  createNoteSchema,
  listQuerySchema,
  MAX_NOTES_PER_OWNER,
  MAX_PAGE_SIZE,
  noteListSchema,
  noteSchema,
  noteSummarySchema,
  toNoteSummary,
  updateNoteSchema,
} from "@aih/example-05-dynamodb/src/contract.ts";

// The note shapes are chapter 05's, unchanged. So is the limit, which now counts per signed-in user.
export {
  createNoteSchema,
  listQuerySchema,
  MAX_NOTES_PER_OWNER,
  MAX_PAGE_SIZE,
  noteListSchema,
  noteSchema,
  noteSummarySchema,
  toNoteSummary,
  updateNoteSchema,
};
export type {
  CreateNote,
  Note,
  NoteList,
  NoteSummary,
  UpdateNote,
} from "@aih/example-05-dynamodb/src/contract.ts";

export const healthSchema = z.object({ status: z.literal("ok"), stage: z.string() });

// #region me
export const meSchema = z.object({
  /** Stable. Not an email address or a name. */
  sub: z.string().min(1),
});
export type Me = z.infer<typeof meSchema>;
// #endregion me

// #region error
// No "forbidden" for notes, on purpose: someone else's note answers `not_found`,
// so the response does not reveal which note IDs are in use.
export const errorCodes = [
  "invalid_request",
  "unauthenticated",
  "not_found",
  "conflict",
  // The caller already holds MAX_NOTES_PER_OWNER notes.
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
    current: noteSchema.optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorSchema>;
// #endregion error
