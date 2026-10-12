import * as v from "valibot";

// #region env
// Read next to chapter 05's variables (ALLOWED_ORIGIN, NOTES_STORE, TABLE_NAME, ...).
const uploadsEnvSchema = v.variant("UPLOADS_STORE", [
  v.object({ UPLOADS_STORE: v.literal("memory") }),
  v.object({
    UPLOADS_STORE: v.literal("s3"),
    UPLOADS_BUCKET: v.pipe(v.string(), v.minLength(3)),
  }),
]);

export type UploadsEnv = v.InferOutput<typeof uploadsEnvSchema>;

export function parseUploadsEnv(source: Record<string, string | undefined>): UploadsEnv {
  const result = v.safeParse(uploadsEnvSchema, source);
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}
// #endregion env
