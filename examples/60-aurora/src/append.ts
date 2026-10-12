import * as v from "valibot";

import { type Queryable, rows } from "@aih/example-13-sql/src/db.ts";

/** The CHECK on app.notes.body in chapter 13's migration 0003. */
export const MAX_BODY_LENGTH = 10_000;

// #region append
export const appendResultSchema = v.variant("status", [
  v.object({
    status: v.literal("appended"),
    version: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    length: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  }),
  v.object({ status: v.literal("too_long") }),
  v.object({ status: v.literal("not_found") }),
]);
export type AppendResult = v.InferOutput<typeof appendResultSchema>;

const appendedRowSchema = v.object({
  version: v.pipe(v.number(), v.safeInteger()),
  length: v.pipe(v.number(), v.safeInteger()),
});
const presentRowSchema = v.object({ present: v.literal(1) });

/**
 * Adds `text` to the end of a note. Unlike chapter 13's update, nothing in the
 * request says which version it expects, so running it twice appends twice.
 * The explicit casts keep the statement the same for every driver.
 */
export async function appendToNote(
  tx: Queryable,
  input: { owner: string; id: string; text: string; at: Date },
): Promise<AppendResult> {
  const [appended] = await rows(
    tx,
    appendedRowSchema,
    `UPDATE app.notes
     SET body = body || CAST($3 AS text), version = version + 1, updated_at = CAST($4 AS timestamptz)
     WHERE owner = $1 AND id = CAST($2 AS uuid) AND char_length(body) + char_length(CAST($3 AS text)) <= CAST($5 AS integer)
     RETURNING version, char_length(body) AS length`,
    [input.owner, input.id, input.text, input.at.toISOString(), MAX_BODY_LENGTH],
  );
  if (appended !== undefined) {
    return { status: "appended", ...appended };
  }
  const present = await rows(
    tx,
    presentRowSchema,
    "SELECT 1 AS present FROM app.notes WHERE owner = $1 AND id = CAST($2 AS uuid)",
    [input.owner, input.id],
  );
  return { status: present.length === 0 ? "not_found" : "too_long" };
}
// #endregion append
