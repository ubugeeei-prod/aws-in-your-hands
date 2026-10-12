import * as v from "valibot";

// `v.url()` alone accepts "localhost:8000", which parses as a URL whose scheme is "localhost".
const httpUrl = v.pipe(
  v.string(),
  v.url(),
  v.regex(/^https?:\/\//, "Must be an http or https URL."),
);
const valkeyUrl = v.pipe(
  v.string(),
  v.url(),
  v.regex(/^(valkeys?|rediss?):\/\//, "Must be a valkey, valkeys, redis, or rediss URL."),
);

// An environment variable is a string. "5" becomes 5; "five" becomes NaN, which `v.number()` refuses.
const integer = (min: number, fallback: number) =>
  v.optional(
    v.pipe(v.string(), v.transform(Number), v.number(), v.integer(), v.minValue(min)),
    String(fallback),
  );

const base = {
  LOG_LEVEL: v.optional(v.picklist(["debug", "info", "warn", "error"]), "info"),
  STAGE: v.optional(v.pipe(v.string(), v.minLength(1)), "local"),
  RATE_LIMIT: integer(1, 5),
  RATE_WINDOW_SECONDS: integer(1, 60),
  RATE_ALGORITHM: v.optional(v.picklist(["fixed", "sliding"]), "fixed"),
  /** What to do when the counter store fails: let the request through, or refuse it. */
  RATE_ON_ERROR: v.optional(v.picklist(["allow", "deny"]), "allow"),
  CACHE_TTL_SECONDS: integer(1, 30),
  SOURCE_DELAY_MS: integer(0, 300),
};

// #region env
// Each store brings its own required settings, so a missing one fails at startup.
const envSchema = v.variant("KV_STORE", [
  v.object({ ...base, KV_STORE: v.literal("memory") }),
  v.object({
    ...base,
    KV_STORE: v.literal("dynamodb"),
    TABLE_NAME: v.pipe(v.string(), v.minLength(3)),
    // DynamoDB Local only. In AWS the SDK finds the regional endpoint itself.
    DYNAMODB_ENDPOINT: v.optional(httpUrl),
  }),
  v.object({
    ...base,
    KV_STORE: v.literal("valkey"),
    // A Valkey on this machine: no TLS, no password.
    VALKEY_URL: valkeyUrl,
  }),
  v.object({
    ...base,
    KV_STORE: v.literal("elasticache"),
    VALKEY_ENDPOINT: v.pipe(v.string(), v.minLength(1)),
    VALKEY_PORT: integer(1, 6379),
    VALKEY_CACHE_NAME: v.pipe(v.string(), v.minLength(1)),
    VALKEY_USER: v.pipe(v.string(), v.minLength(1)),
    // Set by the Lambda runtime.
    AWS_REGION: v.pipe(v.string(), v.minLength(1)),
  }),
]);
// #endregion env

export type Env = v.InferOutput<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = v.safeParse(envSchema, source);
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}
