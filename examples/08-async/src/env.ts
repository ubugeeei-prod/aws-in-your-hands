import { z } from "zod";

function parse<T>(schema: z.ZodType<T>, source: Record<string, string | undefined>): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}

// #region env
// The worker and the housekeeping function. Neither serves HTTP, so neither
// needs chapter 05's ALLOWED_ORIGIN.
const functionEnvSchema = z.object({
  TABLE_NAME: z.string().min(3),
  UPLOADS_BUCKET: z.string().min(3),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});
export type FunctionEnv = z.infer<typeof functionEnvSchema>;

export const parseFunctionEnv = (source: Record<string, string | undefined>): FunctionEnv =>
  parse(functionEnvSchema, source);
// #endregion env

const localQueueEnvSchema = z.object({
  LOCAL_QUEUE_VISIBILITY_SECONDS: z.coerce.number().int().min(1).max(600).default(5),
  LOCAL_QUEUE_MAX_RECEIVE_COUNT: z.coerce.number().int().min(1).max(100).default(3),
  LOCAL_QUEUE_DUPLICATE: z.enum(["true", "false"]).default("false"),
});
export type LocalQueueEnv = z.infer<typeof localQueueEnvSchema>;

export const parseLocalQueueEnv = (source: Record<string, string | undefined>): LocalQueueEnv =>
  parse(localQueueEnvSchema, source);
