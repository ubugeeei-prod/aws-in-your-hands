import { z } from "zod";

// #region env
const envSchema = z.object({
  // No default: whether a request costs money is chosen, never assumed.
  AI_BACKEND: z.enum(["fixture", "bedrock"]),
  // A model ID or an inference profile ID. See infra/lib/models.ts for the checked ones.
  BEDROCK_MODEL_ID: z.string().min(1),
  // Lambda sets this itself.
  AWS_REGION: z.string().min(1).default("ap-northeast-1"),
  MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(1000).default(400),
  INFERENCE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(30_000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  STAGE: z.string().min(1).default("local"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}
// #endregion env
