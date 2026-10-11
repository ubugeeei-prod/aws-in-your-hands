import { z } from "zod";

// #region env
// Read next to chapter 05's variables (ALLOWED_ORIGIN, NOTES_STORE, TABLE_NAME, ...).
const uploadsEnvSchema = z.discriminatedUnion("UPLOADS_STORE", [
  z.object({ UPLOADS_STORE: z.literal("memory") }),
  z.object({ UPLOADS_STORE: z.literal("s3"), UPLOADS_BUCKET: z.string().min(3) }),
]);

export type UploadsEnv = z.infer<typeof uploadsEnvSchema>;

export function parseUploadsEnv(source: Record<string, string | undefined>): UploadsEnv {
  const result = uploadsEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}
// #endregion env
