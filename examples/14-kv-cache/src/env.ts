import { z } from "zod";

// `z.url()` alone accepts "localhost:8000", which parses as a URL whose scheme is "localhost".
const httpUrl = z.url({ protocol: /^https?$/ });
const valkeyUrl = z.url({ protocol: /^valkeys?$|^rediss?$/ });

const base = z.object({
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  STAGE: z.string().min(1).default("local"),
  RATE_LIMIT: z.coerce.number().int().positive().default(5),
  RATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_ALGORITHM: z.enum(["fixed", "sliding"]).default("fixed"),
  /** What to do when the counter store fails: let the request through, or refuse it. */
  RATE_ON_ERROR: z.enum(["allow", "deny"]).default("allow"),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(30),
  SOURCE_DELAY_MS: z.coerce.number().int().nonnegative().default(300),
});

// #region env
// Each store brings its own required settings, so a missing one fails at startup.
const envSchema = z.discriminatedUnion("KV_STORE", [
  base.extend({ KV_STORE: z.literal("memory") }),
  base.extend({
    KV_STORE: z.literal("dynamodb"),
    TABLE_NAME: z.string().min(3),
    // DynamoDB Local only. In AWS the SDK finds the regional endpoint itself.
    DYNAMODB_ENDPOINT: httpUrl.optional(),
  }),
  base.extend({
    KV_STORE: z.literal("valkey"),
    // A Valkey on this machine: no TLS, no password.
    VALKEY_URL: valkeyUrl,
  }),
  base.extend({
    KV_STORE: z.literal("elasticache"),
    VALKEY_ENDPOINT: z.string().min(1),
    VALKEY_PORT: z.coerce.number().int().positive().default(6379),
    VALKEY_CACHE_NAME: z.string().min(1),
    VALKEY_USER: z.string().min(1),
    // Set by the Lambda runtime.
    AWS_REGION: z.string().min(1),
  }),
]);
// #endregion env

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
