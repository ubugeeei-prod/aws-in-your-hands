import * as v from "valibot";

// #region env
const envSchema = v.object({
  EXPORT_BUCKET: v.pipe(v.string(), v.minLength(3)),
  LOG_LEVEL: v.optional(v.picklist(["debug", "info", "warn", "error"]), "info"),
});
export type FunctionEnv = v.InferOutput<typeof envSchema>;

// An environment variable is text. "100" becomes 100; "many" becomes NaN, which v.number() refuses.
const count = (min: number, max: number) =>
  v.pipe(
    v.string(),
    v.transform(Number),
    v.number(),
    v.integer(),
    v.minValue(min),
    v.maxValue(max),
  );

// Only the function that reads notes needs these.
const pagesEnvSchema = v.object({
  ...envSchema.entries,
  TABLE_NAME: v.pipe(v.string(), v.minLength(3)),
  PAGE_SIZE: v.optional(count(1, 1000), "100"),
  /** Stop starting new pages when less than this is left of the function's timeout. */
  RESERVE_SECONDS: v.optional(count(1, 600), "60"),
});
export type PagesEnv = v.InferOutput<typeof pagesEnvSchema>;
// #endregion env

function parse<T>(
  schema: v.GenericSchema<unknown, T>,
  source: Record<string, string | undefined>,
): T {
  const result = v.safeParse(schema, source);
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}

export const parseFunctionEnv = (source: Record<string, string | undefined>): FunctionEnv =>
  parse(envSchema, source);
export const parsePagesEnv = (source: Record<string, string | undefined>): PagesEnv =>
  parse(pagesEnvSchema, source);
