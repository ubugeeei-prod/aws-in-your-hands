import * as v from "valibot";

// #region schema
// Context arrives untyped, from cdk.json or `-c key=value`. Nothing downstream reads it raw.
export const helloConfigSchema = v.object({
  stage: v.optional(v.picklist(["dev", "prod"]), "dev"),
  // Days S3 keeps a replaced or deleted object version.
  noncurrentVersionDays: v.optional(
    v.pipe(
      // A number from cdk.json, or the string `-c noncurrentVersionDays=30` leaves.
      v.union([v.number(), v.string()]),
      v.transform(Number),
      v.integer(),
      v.minValue(1),
      v.maxValue(365),
    ),
    7,
  ),
});

export type HelloConfig = v.InferOutput<typeof helloConfigSchema>;
// #endregion schema

// #region parse
export function parseHelloConfig(context: Record<string, unknown>): HelloConfig {
  const result = v.safeParse(helloConfigSchema, context);
  if (!result.success) {
    const problems = result.issues.map(
      (issue) => `${v.getDotPath(issue) ?? "(root)"}: ${issue.message}`,
    );
    throw new Error(`Invalid context for the hello stack:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}
// #endregion parse
