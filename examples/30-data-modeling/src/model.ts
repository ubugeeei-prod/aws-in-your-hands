import * as v from "valibot";

import { utcTimestamp } from "@aih/example-04-http-api/src/timestamp.ts";
import { noteSchema } from "@aih/example-05-dynamodb/src/contract.ts";
import { type Attachment, attachmentSchema } from "@aih/example-07-uploads/api/src/contract.ts";

// #region limits
// A note's tags and slug are written in one transaction with the note, so their number is bounded.
export const MAX_TAGS_PER_NOTE = 8;
export const MAX_NOTES_PER_OWNER = 100;
export const MAX_PAGE_SIZE = 20;
// #endregion limits

// #region model
// Everything that becomes part of a key is one of these. None can contain "#", the separator.
export const idSchema = v.pipe(v.string(), v.regex(/^[0-9a-z]{1,64}$/));
export const tagSchema = v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9-]{0,31}$/));
export const slugSchema = v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9-]{0,63}$/));

const tagsSchema = v.pipe(
  v.array(tagSchema),
  v.maxLength(MAX_TAGS_PER_NOTE),
  v.check((tags) => new Set(tags).size === tags.length, "A tag may appear once."),
);

export const taggedNoteSchema = v.object({
  ...noteSchema.entries,
  id: idSchema,
  // A note written by chapter 05 has neither; it reads as untagged.
  tags: v.optional(tagsSchema, []),
  slug: v.optional(slugSchema),
});
export type TaggedNote = v.InferOutput<typeof taggedNoteSchema>;

export const noteChangeSchema = v.object({
  title: noteSchema.entries.title,
  body: noteSchema.entries.body,
  tags: tagsSchema,
  slug: v.optional(slugSchema),
  expectedVersion: noteSchema.entries.version,
  updatedAt: utcTimestamp,
});
export type NoteChange = v.InferOutput<typeof noteChangeSchema>;
// #endregion model

// #region views
// What the index holds for a note: enough for a list, and never the body.
export const noteSummarySchema = v.object({
  id: idSchema,
  title: noteSchema.entries.title,
  version: noteSchema.entries.version,
  createdAt: utcTimestamp,
  updatedAt: utcTimestamp,
  tags: v.optional(tagsSchema, []),
});
export type NoteSummary = v.InferOutput<typeof noteSummarySchema>;

// A copy of the title kept beside each tag, so a tag's list needs no second read.
export const tagEntrySchema = v.object({
  noteId: idSchema,
  title: noteSchema.entries.title,
  createdAt: utcTimestamp,
});
export type TagEntry = v.InferOutput<typeof tagEntrySchema>;

export const noteAttachmentSchema = v.object({ ...attachmentSchema.entries, id: idSchema });
export type { Attachment };
// #endregion views
