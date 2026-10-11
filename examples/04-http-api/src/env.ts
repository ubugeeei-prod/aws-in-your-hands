import { z } from "zod";

// #region env
// process.env is `Record<string, string | undefined>`: every value is
// optional and a string, whatever the code wishes. It is parsed once, at
// start-up, so that a missing or misspelled setting fails the first
// invocation with a clear message instead of misbehaving on some later one.
const envSchema = z.object({
  ALLOWED_ORIGIN: z.url(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  STAGE: z.string().min(1).default("local"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}
// #endregion env
