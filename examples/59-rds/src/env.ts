import * as v from "valibot";

// #region env
const host = v.pipe(v.string(), v.regex(/^[a-z0-9.-]+\.rds\.amazonaws\.com$/));

const envSchema = v.object({
  // v.url() alone would accept "localhost:5173" (scheme "localhost").
  ALLOWED_ORIGIN: v.pipe(
    v.string(),
    v.url(),
    v.regex(/^https?:\/\//, "Must be an http or https URL."),
  ),
  LOG_LEVEL: v.optional(v.picklist(["debug", "info", "warn", "error"]), "info"),
  STAGE: v.optional(v.pipe(v.string(), v.minLength(1)), "local"),
  // Lambda sets this one itself. The token is signed for it.
  AWS_REGION: v.pipe(v.string(), v.regex(/^[a-z]{2}(-[a-z]+)+-\d$/)),
  DB_HOST: host,
  // Empty means there is no read replica, and every read goes to the primary.
  DB_REPLICA_HOST: v.optional(v.union([v.literal(""), host]), ""),
  DB_PORT: v.pipe(
    v.string(),
    v.regex(/^\d{1,5}$/),
    v.transform(Number),
    v.minValue(1),
    v.maxValue(65_535),
  ),
  DB_NAME: v.pipe(v.string(), v.regex(/^[a-z_][a-z0-9_]*$/)),
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
