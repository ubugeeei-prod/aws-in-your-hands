import * as v from "valibot";

// v.url() alone would accept "localhost:8000" (scheme "localhost").
const httpUrl = v.pipe(
  v.string(),
  v.url(),
  v.regex(/^https?:\/\//, "Must be an http or https URL."),
);

const envSchema = v.object({
  TABLE_NAME: v.pipe(v.string(), v.minLength(3)),
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
