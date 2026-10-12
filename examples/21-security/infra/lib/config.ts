import { z } from "zod";

export const WAF_REGION = "us-east-1";

// #region context
/** CDK context, as typed on the command line with `-c name=value`. Everything that costs money by the month starts off. */
export const securityConfigSchema = z.object({
  /** The output of AihSecurityWaf. Absent: the distribution has no web ACL. */
  webAclArn: z
    .string()
    .regex(
      /^arn:aws:wafv2:us-east-1:\d{12}:global\/webacl\/[\w-]+\/[0-9a-f-]{36}$/,
      "must be a CLOUDFRONT-scope web ACL ARN: arn:aws:wafv2:us-east-1:<account>:global/webacl/<name>/<id>",
    )
    .optional(),
  /** `on`: encrypt the secret with a customer managed KMS key instead of aws/secretsmanager. */
  cmk: z.enum(["on", "off"]).default("off"),
  /** How the web ACL treats the core rule set. `count` only records what it would have blocked. */
  wafCommonRules: z.enum(["count", "block"]).default("count"),
  /**
   * At most this many copies of the function run at once. Costs nothing, but off by default:
   * it comes out of the account's concurrency, and an account with a low limit refuses the deploy.
   */
  reservedConcurrency: z.coerce
    .number("must be a whole number such as 5")
    .int("must be a whole number such as 5")
    .min(1, "must be 1 or more: 0 would stop the API")
    .max(1000)
    .optional(),
});
export type SecurityConfig = z.infer<typeof securityConfigSchema>;

export function parseSecurityConfig(context: (key: string) => unknown): SecurityConfig {
  const result = securityConfigSchema.safeParse({
    webAclArn: context("webAclArn"),
    cmk: context("cmk"),
    wafCommonRules: context("wafCommonRules"),
    reservedConcurrency: context("reservedConcurrency"),
  });
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid CDK context:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}
// #endregion context
