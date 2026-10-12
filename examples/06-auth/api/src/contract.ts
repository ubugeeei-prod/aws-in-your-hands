import * as v from "valibot";

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

export const healthSchema = v.object({ status: v.literal("ok"), stage: v.string() });

// #region me
export const meSchema = v.object({
  /** Stable. Not an email address or a name. */
  sub: v.pipe(v.string(), v.minLength(1)),
});
export type Me = v.InferOutput<typeof meSchema>;
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

export const errorSchema = v.object({
  error: v.object({
    code: v.picklist(errorCodes),
    message: v.string(),
    requestId: v.string(),
    issues: v.optional(v.array(v.object({ path: v.string(), message: v.string() }))),
    current: v.optional(noteSchema),
  }),
});
export type ErrorBody = v.InferOutput<typeof errorSchema>;
// #endregion error
