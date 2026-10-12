import * as v from "valibot";

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

// #region env
// The worker and the housekeeping function. Neither serves HTTP, so neither
// needs chapter 05's ALLOWED_ORIGIN.
const functionEnvSchema = v.object({
  TABLE_NAME: v.pipe(v.string(), v.minLength(3)),
  UPLOADS_BUCKET: v.pipe(v.string(), v.minLength(3)),
  LOG_LEVEL: v.optional(v.picklist(["debug", "info", "warn", "error"]), "info"),
});
export type FunctionEnv = v.InferOutput<typeof functionEnvSchema>;

export const parseFunctionEnv = (source: Record<string, string | undefined>): FunctionEnv =>
  parse(functionEnvSchema, source);
// #endregion env

// An environment variable is text. "5" becomes 5; "five" becomes NaN, which v.number() refuses.
const wholeNumber = (min: number, max: number) =>
  v.pipe(
    v.string(),
    v.transform(Number),
    v.number(),
    v.integer(),
    v.minValue(min),
    v.maxValue(max),
  );

const localQueueEnvSchema = v.object({
  LOCAL_QUEUE_VISIBILITY_SECONDS: v.optional(wholeNumber(1, 600), "5"),
  LOCAL_QUEUE_MAX_RECEIVE_COUNT: v.optional(wholeNumber(1, 100), "3"),
  LOCAL_QUEUE_DUPLICATE: v.optional(v.picklist(["true", "false"]), "false"),
});
export type LocalQueueEnv = v.InferOutput<typeof localQueueEnvSchema>;

export const parseLocalQueueEnv = (source: Record<string, string | undefined>): LocalQueueEnv =>
  parse(localQueueEnvSchema, source);
