import { z } from "zod";

const base = z.object({
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  STAGE: z.string().min(1).default("local"),
  TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  KEY_CACHE_SECONDS: z.coerce.number().int().positive().default(300),
  KEY_REFRESH_MIN_SECONDS: z.coerce.number().int().positive().default(30),
});

// #region env
// The environment carries where the secret is, never the secret itself.
const envSchema = z.discriminatedUnion("SECRET_SOURCE", [
  // Local only: a key made up at startup and gone when the process exits.
  base.extend({ SECRET_SOURCE: z.literal("memory") }),
  base.extend({
    SECRET_SOURCE: z.literal("secretsmanager"),
    SECRET_ID: z.string().regex(/^arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:\d{12}:secret:.+$/, "must be a secret ARN"),
  }),
]);
// #endregion env

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse({ SECRET_SOURCE: "memory", ...source });
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}
