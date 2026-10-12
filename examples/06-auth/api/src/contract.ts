import { z } from "zod";

import {
  createNoteSchema,
  listQuerySchema,
  noteListSchema,
  noteSchema,
  updateNoteSchema,
} from "@aih/example-05-dynamodb/src/contract.ts";

// The note shapes are chapter 05's, unchanged.
export { createNoteSchema, listQuerySchema, noteListSchema, noteSchema, updateNoteSchema };
export type {
  CreateNote,
  Note,
  NoteList,
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
