import * as v from "valibot";

const name = v.pipe(v.string(), v.minLength(1));
const wholeNumber = (minimum: number, maximum: number) =>
  v.pipe(
    v.string(),
    v.regex(/^\d+$/, "Must be a whole number."),
    v.transform(Number),
    v.minValue(minimum),
    v.maxValue(maximum),
  );

// #region env
const settingsSchema = v.object({
  // Lambda sets this to the number of the version that is running, or to $LATEST.
  AWS_LAMBDA_FUNCTION_VERSION: v.optional(name, "local"),
  // Share of requests this build answers with a 500. Only for practising a rollback.
  FAULT_PERCENT: v.optional(wholeNumber(0, 100), "0"),
  FLAGS_FILE: v.optional(name),
  FLAGS_APPLICATION: v.optional(name),
  FLAGS_ENVIRONMENT: v.optional(name),
  FLAGS_PROFILE: v.optional(name),
  AWS_APPCONFIG_EXTENSION_HTTP_PORT: v.optional(wholeNumber(1, 65_535), "2772"),
  FLAGS_TIMEOUT_MS: v.optional(wholeNumber(1, 10_000), "500"),
});

export type FlagSettings =
  | { from: "file"; path: string }
  | {
      from: "extension";
      port: number;
      application: string;
      environment: string;
      profile: string;
      timeoutMs: number;
    };

export type RolloutEnv = { version: string; faultPercent: number; flags: FlagSettings };

export function parseRolloutEnv(source: Record<string, string | undefined>): RolloutEnv {
  const result = v.safeParse(settingsSchema, source);
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  const env = result.output;
  const base = { version: env.AWS_LAMBDA_FUNCTION_VERSION, faultPercent: env.FAULT_PERCENT };
  if (env.FLAGS_FILE !== undefined) {
    return { ...base, flags: { from: "file", path: env.FLAGS_FILE } };
  }
  const { FLAGS_APPLICATION, FLAGS_ENVIRONMENT, FLAGS_PROFILE } = env;
  if (
    FLAGS_APPLICATION === undefined ||
    FLAGS_ENVIRONMENT === undefined ||
    FLAGS_PROFILE === undefined
  ) {
    // No silent "all defaults": a build that cannot be told anything should say so at start.
    throw new Error(
      "Invalid environment:\n  Set FLAGS_FILE, or FLAGS_APPLICATION, FLAGS_ENVIRONMENT, and FLAGS_PROFILE.",
    );
  }
  return {
    ...base,
    flags: {
      from: "extension",
      port: env.AWS_APPCONFIG_EXTENSION_HTTP_PORT,
      application: FLAGS_APPLICATION,
      environment: FLAGS_ENVIRONMENT,
      profile: FLAGS_PROFILE,
      timeoutMs: env.FLAGS_TIMEOUT_MS,
    },
  };
}
// #endregion env
