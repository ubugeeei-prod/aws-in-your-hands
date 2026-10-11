import { z } from "zod";

// #region schema
export const noteSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  body: z.string().max(10_000),
  updatedAt: z.iso.datetime(),
});

export type Note = z.infer<typeof noteSchema>;

export const noteDraftSchema = noteSchema.pick({ title: true, body: true });
export type NoteDraft = z.infer<typeof noteDraftSchema>;
// #endregion schema
