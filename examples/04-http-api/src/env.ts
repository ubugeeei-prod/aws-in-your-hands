import * as v from "valibot";

// #region env
const envSchema = v.object({
  // v.url() alone would accept "localhost:5173" (scheme "localhost").
  ALLOWED_ORIGIN: v.pipe(
    v.string(),
    v.url(),
    v.regex(/^https?:\/\//, "Must be an http or https URL."),
  ),
  LOG_LEVEL: v.optional(v.picklist(["debug", "info", "warn", "error"]), "info"),
  STAGE: v.optional(v.pipe(v.string(), v.minLength(1)), "local"),
});

export type Env = v.InferOutput<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = v.safeParse(envSchema, source);
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}
// #endregion env
