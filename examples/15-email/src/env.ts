import * as v from "valibot";

import { emailAddressSchema } from "./contract.ts";

const logLevel = v.optional(v.picklist(["debug", "info", "warn", "error"]), "info");

// #region env
const base = {
  LOG_LEVEL: logLevel,
  STAGE: v.optional(v.pipe(v.string(), v.minLength(1)), "local"),
  FROM_ADDRESS: emailAddressSchema,
  // v.url() alone would accept "localhost:5173" (scheme "localhost").
  APP_ORIGIN: v.pipe(v.string(), v.url(), v.regex(/^https?:\/\//, "Must be an http or https URL.")),
  // An environment variable is always text. Number("abc") is NaN, which v.number() refuses.
  RETENTION_DAYS: v.optional(
    v.pipe(
      v.string(),
      v.transform(Number),
      v.number(),
      v.integer(),
      v.minValue(1),
      v.maxValue(365),
    ),
    "30",
  ),
};

// "aws" needs the table and the configuration set, so a missing name fails at startup.
const envSchema = v.variant("MAIL_MODE", [
  v.object({ ...base, MAIL_MODE: v.literal("local") }),
  v.object({
    ...base,
    MAIL_MODE: v.literal("aws"),
    TABLE_NAME: v.pipe(v.string(), v.minLength(3)),
    CONFIGURATION_SET_NAME: v.pipe(v.string(), v.minLength(1)),
  }),
]);
export type Env = v.InferOutput<typeof envSchema>;

/** The function that records bounces sends nothing, so it is given less. */
const eventsEnvSchema = v.object({
  LOG_LEVEL: logLevel,
  TABLE_NAME: v.pipe(v.string(), v.minLength(3)),
});
export type EventsEnv = v.InferOutput<typeof eventsEnvSchema>;
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

export const parseEnv = (source: Record<string, string | undefined>): Env =>
  parse(envSchema, source);
export const parseEventsEnv = (source: Record<string, string | undefined>): EventsEnv =>
  parse(eventsEnvSchema, source);
