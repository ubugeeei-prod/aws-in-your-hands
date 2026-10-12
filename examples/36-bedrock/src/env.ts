import * as v from "valibot";

import { isKnownModel } from "./models.ts";

// #region env
// An environment variable is text, and so is its default.
const wholeNumber = (min: number, max: number) =>
  v.pipe(
    v.string(),
    v.transform(Number),
    v.number(),
    v.integer(),
    v.minValue(min),
    v.maxValue(max),
  );

const envSchema = v.pipe(
  v.object({
    // No default: whether a request costs money is chosen, never assumed.
    AI_BACKEND: v.picklist(["scripted", "bedrock"]),
    // The code never names a model. This is the one place a model ID enters, and only an
    // ID whose abilities and prices are written down in models.ts gets in.
    BEDROCK_MODEL_ID: v.pipe(
      v.string(),
      v.check(isKnownModel, "is not in src/models.ts"),
      v.transform((value) => (isKnownModel(value) ? value : "jp.amazon.nova-2-lite-v1:0")),
    ),
    // Lambda sets this itself.
    AWS_REGION: v.optional(v.pipe(v.string(), v.minLength(1)), "ap-northeast-1"),
    MAX_OUTPUT_TOKENS: v.optional(wholeNumber(1, 2000), "600"),
    // At most 4: each further turn adds a cache point, and a request may carry 4.
    MAX_TURNS: v.optional(wholeNumber(1, 4), "4"),
    MAX_TOTAL_TOKENS: v.optional(wholeNumber(1000, 200_000), "20000"),
    INFERENCE_TIMEOUT_MS: v.optional(wholeNumber(1000, 120_000), "60000"),
    // What one owner may spend in a UTC day, in millionths of a dollar. 500000 is USD 0.50.
    DAILY_BUDGET_MICRO_USD: v.optional(wholeNumber(0, 1_000_000_000), "500000"),
    // Both or neither. Empty means the same as absent.
    GUARDRAIL_ID: v.optional(v.string(), ""),
    GUARDRAIL_VERSION: v.optional(
      v.union([v.literal(""), v.pipe(v.string(), v.regex(/^[1-9]\d{0,7}$/))]),
      "",
    ),
    PROMPT_CACHE: v.optional(v.picklist(["on", "off"]), "off"),
    // Only the deployed function reads these two.
    NOTES_TABLE_NAME: v.optional(v.string(), ""),
    USAGE_TABLE_NAME: v.optional(v.string(), ""),
    LOG_LEVEL: v.optional(v.picklist(["debug", "info", "warn", "error"]), "info"),
    STAGE: v.optional(v.pipe(v.string(), v.minLength(1)), "local"),
  }),
  v.check(
    (env) => (env.GUARDRAIL_ID === "") === (env.GUARDRAIL_VERSION === ""),
    "GUARDRAIL_ID and GUARDRAIL_VERSION go together",
  ),
);

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
