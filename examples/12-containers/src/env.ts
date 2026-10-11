import { type Env, parseEnv } from "@aih/example-04-http-api/src/env.ts";
import { z } from "zod";

// #region env
// What the container adds to chapter 04's settings.
const serverEnvSchema = z.object({
  // Above 1023, so the process needs no privilege to listen.
  PORT: z.coerce.number().int().min(0).max(65_535).default(8080),
  APP_VERSION: z.string().min(1).max(128).default("dev"),
});

export type ServerEnv = Env & z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const app = parseEnv(source);
  const server = serverEnvSchema.safeParse(source);
  if (!server.success) {
    const problems = server.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return { ...app, ...server.data };
}
// #endregion env
