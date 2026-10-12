import * as v from "valibot";

import { isKnownModel } from "@aih/example-36-bedrock/src/models.ts";

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

const envSchema = v.object({
  // No default: whether a question costs money is chosen, never assumed.
  AI_BACKEND: v.picklist(["scripted", "bedrock"]),
  BEDROCK_MODEL_ID: v.pipe(
    v.string(),
    v.check(isKnownModel, "is not in chapter 36's src/models.ts"),
    v.transform((value) => (isKnownModel(value) ? value : "jp.amazon.nova-2-lite-v1:0")),
  ),
  // Set by the stack. Nothing here relies on a variable the runtime may or may not provide.
  AGENT_REGION: v.optional(v.pipe(v.string(), v.minLength(1)), "ap-northeast-1"),
  // The HTTP contract of AgentCore Runtime fixes 8080. Only local checks choose another.
  PORT: v.optional(wholeNumber(1, 65_535), "8080"),
  MAX_OUTPUT_TOKENS: v.optional(wholeNumber(1, 2000), "600"),
  MAX_TURNS: v.optional(wholeNumber(1, 4), "4"),
  MAX_TOTAL_TOKENS: v.optional(wholeNumber(1000, 200_000), "20000"),
  INFERENCE_TIMEOUT_MS: v.optional(wholeNumber(1000, 120_000), "60000"),
  // Only the deployed agent reads these four.
  NOTES_TABLE_NAME: v.optional(v.string(), ""),
  MEMORY_ID: v.optional(v.string(), ""),
  JWT_ISSUER: v.optional(v.string(), ""),
  JWT_CLIENT_ID: v.optional(v.string(), ""),
  LOG_LEVEL: v.optional(v.picklist(["debug", "info", "warn", "error"]), "info"),
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
