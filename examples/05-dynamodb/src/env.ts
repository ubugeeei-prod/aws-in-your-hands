import * as v from "valibot";

// #region env
// v.url() alone would accept "localhost:8000" (scheme "localhost").
const httpUrl = v.pipe(
  v.string(),
  v.url(),
  v.regex(/^https?:\/\//, "Must be an http or https URL."),
);

const base = {
  ALLOWED_ORIGIN: httpUrl,
  LOG_LEVEL: v.optional(v.picklist(["debug", "info", "warn", "error"]), "info"),
  STAGE: v.optional(v.pipe(v.string(), v.minLength(1)), "local"),
};

// Required variables depend on the store, so a missing TABLE_NAME fails at startup.
const envSchema = v.variant("NOTES_STORE", [
  v.object({ ...base, NOTES_STORE: v.literal("memory") }),
  v.object({
    ...base,
    NOTES_STORE: v.literal("dynamodb"),
    TABLE_NAME: v.pipe(v.string(), v.minLength(3)),
    // DynamoDB Local only. In AWS the SDK finds the regional endpoint itself.
    DYNAMODB_ENDPOINT: v.optional(httpUrl),
  }),
]);

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
