import { z } from "zod";

// #region env
const base = z.object({
  // z.url() alone would accept "localhost:5173" (scheme "localhost").
  ALLOWED_ORIGIN: z.url({ protocol: /^https?$/ }),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  STAGE: z.string().min(1).default("local"),
});

// `<cluster id>.dsql.<region>.on.aws`. The region is read from the name, so
// the token is always signed for the region the cluster is in.
const DSQL_ENDPOINT = /^[a-z0-9]+\.dsql\.([a-z0-9-]+)\.on\.aws$/;

const envSchema = z.discriminatedUnion("NOTES_DB", [
  base.extend({
    NOTES_DB: z.literal("pglite"),
    PGLITE_DATA_DIR: z.string().min(1).default(".pglite"),
  }),
  base.extend({
    NOTES_DB: z.literal("dsql"),
    DSQL_ENDPOINT: z.string().regex(DSQL_ENDPOINT),
    // A database role, not an IAM role. `vp run sql:db:grant` creates it.
    DSQL_USER: z
      .string()
      .regex(/^[a-z_][a-z0-9_]*$/)
      .default("notes_api"),
  }),
]);

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}

export function regionOfEndpoint(endpoint: string): string {
  const region = DSQL_ENDPOINT.exec(endpoint)?.[1];
  if (region === undefined) {
    throw new Error(`${endpoint} is not an Aurora DSQL cluster endpoint`);
  }
  return region;
}
// #endregion env
