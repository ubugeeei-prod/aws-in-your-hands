import * as v from "valibot";

// #region env
const base = {
  // v.url() alone would accept "localhost:5173" (scheme "localhost").
  ALLOWED_ORIGIN: v.pipe(
    v.string(),
    v.url(),
    v.regex(/^https?:\/\//, "Must be an http or https URL."),
  ),
  LOG_LEVEL: v.optional(v.picklist(["debug", "info", "warn", "error"]), "info"),
  STAGE: v.optional(v.pipe(v.string(), v.minLength(1)), "local"),
};

// `<cluster id>.dsql.<region>.on.aws`. The region is read from the name, so
// the token is always signed for the region the cluster is in.
const DSQL_ENDPOINT = /^[a-z0-9]+\.dsql\.([a-z0-9-]+)\.on\.aws$/;

const envSchema = v.variant("NOTES_DB", [
  v.object({
    ...base,
    NOTES_DB: v.literal("pglite"),
    PGLITE_DATA_DIR: v.optional(v.pipe(v.string(), v.minLength(1)), ".pglite"),
  }),
  v.object({
    ...base,
    NOTES_DB: v.literal("dsql"),
    DSQL_ENDPOINT: v.pipe(v.string(), v.regex(DSQL_ENDPOINT)),
    // A database role, not an IAM role. `vp run sql:db:grant` creates it.
    DSQL_USER: v.optional(v.pipe(v.string(), v.regex(/^[a-z_][a-z0-9_]*$/)), "notes_api"),
  }),
]);

export type Env = v.InferOutput<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = v.safeParse(envSchema, source);
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}

export function regionOfEndpoint(endpoint: string): string {
  const region = DSQL_ENDPOINT.exec(endpoint)?.[1];
  if (region === undefined) {
    throw new Error(`${endpoint} is not an Aurora DSQL cluster endpoint`);
  }
  return region;
}
// #endregion env
