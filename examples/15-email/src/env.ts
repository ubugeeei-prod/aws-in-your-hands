import { z } from "zod";

import { emailAddressSchema } from "./contract.ts";

const logLevel = z.enum(["debug", "info", "warn", "error"]).default("info");

// #region env
const base = z.object({
  LOG_LEVEL: logLevel,
  STAGE: z.string().min(1).default("local"),
  FROM_ADDRESS: emailAddressSchema,
  // z.url() alone would accept "localhost:5173" (scheme "localhost").
  APP_ORIGIN: z.url({ protocol: /^https?$/ }),
  RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
});

// "aws" needs the table and the configuration set, so a missing name fails at startup.
const envSchema = z.discriminatedUnion("MAIL_MODE", [
  base.extend({ MAIL_MODE: z.literal("local") }),
  base.extend({
    MAIL_MODE: z.literal("aws"),
    TABLE_NAME: z.string().min(3),
    CONFIGURATION_SET_NAME: z.string().min(1),
  }),
]);
export type Env = z.infer<typeof envSchema>;

/** The function that records bounces sends nothing, so it is given less. */
const eventsEnvSchema = z.object({ LOG_LEVEL: logLevel, TABLE_NAME: z.string().min(3) });
export type EventsEnv = z.infer<typeof eventsEnvSchema>;
// #endregion env

function parse<T>(schema: z.ZodType<T>, source: Record<string, string | undefined>): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}

export const parseEnv = (source: Record<string, string | undefined>): Env =>
  parse(envSchema, source);
export const parseEventsEnv = (source: Record<string, string | undefined>): EventsEnv =>
  parse(eventsEnvSchema, source);
