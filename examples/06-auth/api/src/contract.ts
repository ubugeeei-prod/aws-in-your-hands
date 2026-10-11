import {
  createNoteSchema,
  listQuerySchema,
  noteListSchema,
  noteSchema,
  updateNoteSchema,
} from "@aih/example-05-dynamodb/src/contract.ts";
import { z } from "zod";

// The note shapes are chapter 05's, unchanged. What this chapter adds to the
// contract is who is asking.
export { createNoteSchema, listQuerySchema, noteListSchema, noteSchema, updateNoteSchema };
export type { CreateNote, Note, NoteList, UpdateNote } from "@aih/example-05-dynamodb/src/contract.ts";

export const healthSchema = z.object({ status: z.literal("ok"), stage: z.string() });

// #region me
export const meSchema = z.object({
  /** The user pool's identifier for this user. Stable; not an email address or a name. */
  sub: z.string().min(1),
});
export type Me = z.infer<typeof meSchema>;
// #endregion me

// #region error
// `unauthenticated` (401): the API does not know who is asking.
// There is deliberately no "forbidden" for notes: asking for someone else's
// note gets the same `not_found` as asking for one that does not exist, so the
// answer does not reveal which note IDs are in use.
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
