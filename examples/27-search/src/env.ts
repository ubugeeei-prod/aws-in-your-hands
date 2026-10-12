import * as v from "valibot";

// #region env
const wholeNumber = (min: number, max: number) =>
  v.pipe(
    v.string(),
    v.transform(Number),
    v.number(),
    v.integer(),
    v.minValue(min),
    v.maxValue(max),
  );

const base = {
  LOG_LEVEL: v.optional(v.picklist(["debug", "info", "warn", "error"]), "info"),
  STAGE: v.optional(v.pipe(v.string(), v.minLength(1)), "local"),
  MAX_OUTPUT_TOKENS: v.optional(wholeNumber(1, 1000), "400"),
  INFERENCE_TIMEOUT_MS: v.optional(wholeNumber(1000, 60_000), "30000"),
};

const name = v.pipe(v.string(), v.minLength(3));

// No default for the backend: whether a request costs money is chosen, never assumed.
const envSchema = v.variant("SEARCH_BACKEND", [
  // Everything in this process: a Map for notes, a Map for vectors, no model.
  v.object({ ...base, SEARCH_BACKEND: v.literal("local") }),
  // DynamoDB, S3 Vectors, and Bedrock. Every search embeds its query, and that is billed.
  v.object({
    ...base,
    SEARCH_BACKEND: v.literal("aws"),
    TABLE_NAME: name,
    VECTOR_INDEX_ARN: v.pipe(v.string(), v.startsWith("arn:")),
    // An inference profile ID from chapter 17's list.
    BEDROCK_MODEL_ID: v.pipe(v.string(), v.minLength(1)),
    // Lambda sets this itself.
    AWS_REGION: v.optional(v.pipe(v.string(), v.minLength(1)), "ap-northeast-1"),
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

// #region indexer-env
const indexerEnvSchema = v.object({
  VECTOR_INDEX_ARN: v.pipe(v.string(), v.startsWith("arn:")),
  AWS_REGION: v.optional(v.pipe(v.string(), v.minLength(1)), "ap-northeast-1"),
  LOG_LEVEL: v.optional(v.picklist(["debug", "info", "warn", "error"]), "info"),
});

export function parseIndexerEnv(source: Record<string, string | undefined>) {
  return v.parse(indexerEnvSchema, source);
}
// #endregion indexer-env
