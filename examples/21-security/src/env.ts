import * as v from "valibot";

// An environment variable is a string. Number() reads it, so " 300 " and "3e2" are 300 too;
// what is refused is anything that does not come out a whole number of 1 or more
// ("", "abc", "2.5", "0", "Infinity"). The default is a string too: it goes through the same checks.
const seconds = (fallback: string) =>
  v.optional(v.pipe(v.string(), v.transform(Number), v.safeInteger(), v.minValue(1)), fallback);

const base = {
  LOG_LEVEL: v.optional(v.picklist(["debug", "info", "warn", "error"]), "info"),
  STAGE: v.optional(v.pipe(v.string(), v.minLength(1)), "local"),
  TOKEN_TTL_SECONDS: seconds("300"),
  KEY_CACHE_SECONDS: seconds("300"),
  KEY_REFRESH_MIN_SECONDS: seconds("30"),
};

// #region env
// The environment carries where the secret is, never the secret itself.
const envSchema = v.variant("SECRET_SOURCE", [
  // Local only: a key made up at startup and gone when the process exits.
  v.object({ ...base, SECRET_SOURCE: v.literal("memory") }),
  v.object({
    ...base,
    SECRET_SOURCE: v.literal("secretsmanager"),
    SECRET_ID: v.pipe(
      v.string(),
      v.regex(
        /^arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:\d{12}:secret:.+$/,
        "must be a secret ARN",
      ),
    ),
  }),
]);
// #endregion env

export type Env = v.InferOutput<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = v.safeParse(envSchema, { SECRET_SOURCE: "memory", ...source });
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}
