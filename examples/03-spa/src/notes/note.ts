import * as v from "valibot";

// #region schema
export const noteSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  body: v.pipe(v.string(), v.maxLength(10_000)),
  updatedAt: v.pipe(v.string(), v.isoTimestamp()),
});

export type Note = v.InferOutput<typeof noteSchema>;

export const noteDraftSchema = v.pick(noteSchema, ["title", "body"]);
export type NoteDraft = v.InferOutput<typeof noteDraftSchema>;
// #endregion schema
