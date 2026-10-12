import { z } from "zod";

import { parseEnv } from "@aih/example-04-http-api/src/env.ts";

// #region env
const serverEnvSchema = z.object({
  // Loopback unless told otherwise. On the instance, the way in is SSM port forwarding.
  HOST: z.union([z.ipv4(), z.literal("localhost")]).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  NOTES_FILE: z.string().min(1),
});

/** The API's own settings from chapter 04, plus where to listen and where the notes live. */
export function parseServerEnv(source: Record<string, string | undefined>) {
  const server = serverEnvSchema.safeParse(source);
  if (!server.success) {
    const problems = server.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return { ...parseEnv(source), ...server.data };
}

export type ServerEnv = ReturnType<typeof parseServerEnv>;
// #endregion env
