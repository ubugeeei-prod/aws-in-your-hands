import { z } from "zod";

// #region schema
// CDK context arrives as untyped JSON from cdk.json or `-c key=value`. This
// schema is the one place where it becomes a typed value; nothing downstream
// reads raw context.
export const helloConfigSchema = z.object({
  stage: z.enum(["dev", "prod"]).default("dev"),
  // How long S3 keeps a replaced or deleted object version before removing it.
  noncurrentVersionDays: z.coerce.number().int().min(1).max(365).default(7),
});

export type HelloConfig = z.infer<typeof helloConfigSchema>;
// #endregion schema

// #region parse
export function parseHelloConfig(context: Record<string, unknown>): HelloConfig {
  const result = helloConfigSchema.safeParse(context);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new Error(`Invalid context for the hello stack:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}
// #endregion parse
