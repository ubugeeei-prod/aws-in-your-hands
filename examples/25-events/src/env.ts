import * as v from "valibot";

const level = v.optional(v.picklist(["debug", "info", "warn", "error"]), "info");

// #region env
const consumerEnvSchema = v.object({
  PROJECTIONS_TABLE: v.pipe(v.string(), v.minLength(3)),
  LOG_LEVEL: level,
});
const shapeEnvSchema = v.object({ LOG_LEVEL: level });

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

export const parseConsumerEnv = (source: Record<string, string | undefined>) =>
  parse(consumerEnvSchema, source);
export const parseShapeEnv = (source: Record<string, string | undefined>) =>
  parse(shapeEnvSchema, source);
// #endregion env
