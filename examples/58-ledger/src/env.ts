import * as v from "valibot";

// v.url() alone would accept "localhost:8000" (scheme "localhost").
const httpUrl = v.pipe(
  v.string(),
  v.url(),
  v.regex(/^https?:\/\//, "Must be an http or https URL."),
);

// A table name goes into a PartiQL statement as an identifier, so its alphabet is pinned here.
export const tableNameSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_.-]{3,255}$/));
// A ledger name becomes part of a key and of an object name.
export const ledgerNameSchema = v.pipe(v.string(), v.regex(/^[a-z0-9-]{1,64}$/));

const envSchema = v.object({
  TABLE_NAME: tableNameSchema,
  DIGEST_BUCKET: v.optional(v.pipe(v.string(), v.minLength(3))),
  LEDGER: v.optional(ledgerNameSchema, "notes"),
  // DynamoDB Local only. In AWS the SDK finds the regional endpoint itself.
  DYNAMODB_ENDPOINT: v.optional(httpUrl),
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
