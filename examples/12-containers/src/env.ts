import * as v from "valibot";

import { type Env, parseEnv } from "@aih/example-04-http-api/src/env.ts";

// #region env
// What the container adds to chapter 04's settings.
const serverEnvSchema = v.object({
  // Above 1023, so the process needs no privilege to listen.
  PORT: v.optional(
    v.pipe(
      v.string(),
      v.transform(Number),
      v.number(),
      v.integer(),
      v.minValue(0),
      v.maxValue(65_535),
    ),
    "8080",
  ),
  APP_VERSION: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(128)), "dev"),
});

export type ServerEnv = Env & v.InferOutput<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const app = parseEnv(source);
  const server = v.safeParse(serverEnvSchema, source);
  if (!server.success) {
    const problems = server.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return { ...app, ...server.output };
}
// #endregion env
