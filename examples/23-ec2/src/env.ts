import * as v from "valibot";

import { parseEnv } from "@aih/example-04-http-api/src/env.ts";

// #region env
const serverEnvSchema = v.object({
  // Loopback unless told otherwise. On the instance, the way in is SSM port forwarding.
  HOST: v.optional(v.union([v.pipe(v.string(), v.ipv4()), v.literal("localhost")]), "127.0.0.1"),
  PORT: v.optional(
    v.pipe(
      v.string(),
      v.transform(Number),
      v.number(),
      v.integer(),
      v.minValue(1),
      v.maxValue(65535),
    ),
    "8787",
  ),
  NOTES_FILE: v.pipe(v.string(), v.minLength(1)),
});

/** The API's own settings from chapter 04, plus where to listen and where the notes live. */
export function parseServerEnv(source: Record<string, string | undefined>) {
  const server = v.safeParse(serverEnvSchema, source);
  if (!server.success) {
    const problems = server.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return { ...parseEnv(source), ...server.output };
}

export type ServerEnv = ReturnType<typeof parseServerEnv>;
// #endregion env
