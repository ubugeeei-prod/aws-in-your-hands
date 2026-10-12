import * as v from "valibot";

// #region env
const envSchema = v.object({
  HISTORY_TABLE: v.pipe(v.string(), v.minLength(3)),
  LOG_LEVEL: v.optional(v.picklist(["debug", "info", "warn", "error"]), "info"),
});

export function parseConsumerEnv(source: Record<string, string | undefined>) {
  const result = v.safeParse(envSchema, source);
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}
// #endregion env
