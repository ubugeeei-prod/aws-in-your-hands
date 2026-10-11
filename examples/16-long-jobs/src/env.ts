import { z } from "zod";

// #region env
const envSchema = z.object({
  EXPORT_BUCKET: z.string().min(3),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});
export type FunctionEnv = z.infer<typeof envSchema>;

// Only the function that reads notes needs these.
const pagesEnvSchema = envSchema.extend({
  TABLE_NAME: z.string().min(3),
  PAGE_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  /** Stop starting new pages when less than this is left of the function's timeout. */
  RESERVE_SECONDS: z.coerce.number().int().min(1).max(600).default(60),
});
export type PagesEnv = z.infer<typeof pagesEnvSchema>;
// #endregion env

function parse<T>(schema: z.ZodType<T>, source: Record<string, string | undefined>): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}

export const parseFunctionEnv = (source: Record<string, string | undefined>): FunctionEnv => parse(envSchema, source);
export const parsePagesEnv = (source: Record<string, string | undefined>): PagesEnv => parse(pagesEnvSchema, source);
