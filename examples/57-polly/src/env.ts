import * as v from "valibot";

// #region env
const base = {
  // Lambda sets this itself.
  AWS_REGION: v.optional(v.pipe(v.string(), v.minLength(1)), "ap-northeast-1"),
  LOG_LEVEL: v.optional(v.picklist(["debug", "info", "warn", "error"]), "info"),
  STAGE: v.optional(v.pipe(v.string(), v.minLength(1)), "local"),
};

// No default: whether a request costs money is chosen, never assumed.
const envSchema = v.variant("SPEECH_BACKEND", [
  v.object({ SPEECH_BACKEND: v.literal("fake"), ...base }),
  v.object({
    SPEECH_BACKEND: v.literal("polly"),
    SPEECH_BUCKET: v.pipe(v.string(), v.minLength(3)),
    ...base,
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
