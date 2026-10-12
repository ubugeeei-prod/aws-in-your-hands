import * as v from "valibot";

// #region env
// An environment variable is text, and so is its default. v.number() refuses what
// Number() could not read (NaN).
const wholeNumber = (min: number, max: number) =>
  v.pipe(
    v.string(),
    v.transform(Number),
    v.number(),
    v.integer(),
    v.minValue(min),
    v.maxValue(max),
  );

const envSchema = v.object({
  // No default: whether a request costs money is chosen, never assumed.
  AI_BACKEND: v.picklist(["fixture", "bedrock"]),
  // A model ID or an inference profile ID. See infra/lib/models.ts for the checked ones.
  BEDROCK_MODEL_ID: v.pipe(v.string(), v.minLength(1)),
  // Lambda sets this itself.
  AWS_REGION: v.optional(v.pipe(v.string(), v.minLength(1)), "ap-northeast-1"),
  MAX_OUTPUT_TOKENS: v.optional(wholeNumber(1, 1000), "400"),
  INFERENCE_TIMEOUT_MS: v.optional(wholeNumber(1000, 60_000), "30000"),
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
