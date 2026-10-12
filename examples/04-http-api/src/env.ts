import { z } from "zod";

// #region env
const envSchema = z.object({
  // z.url() alone would accept "localhost:5173" (scheme "localhost").
  ALLOWED_ORIGIN: z.url({ protocol: /^https?$/ }),
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
