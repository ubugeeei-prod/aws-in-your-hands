import * as v from "valibot";

export const WAF_REGION = "us-east-1";

// #region context
/** CDK context, as typed on the command line with `-c name=value`. Everything that costs money by the month starts off. */
const WHOLE = "must be a whole number such as 5";

export const securityConfigSchema = v.object({
  /** The output of AihSecurityWaf. Absent: the distribution has no web ACL. */
  webAclArn: v.optional(
    v.pipe(
      v.string(),
      v.regex(
        /^arn:aws:wafv2:us-east-1:\d{12}:global\/webacl\/[\w-]+\/[0-9a-f-]{36}$/,
        "must be a CLOUDFRONT-scope web ACL ARN: arn:aws:wafv2:us-east-1:<account>:global/webacl/<name>/<id>",
      ),
    ),
  ),
  /** `on`: encrypt the secret with a customer managed KMS key instead of aws/secretsmanager. */
  cmk: v.optional(v.picklist(["on", "off"]), "off"),
  /** How the web ACL treats the core rule set. `count` only records what it would have blocked. */
  wafCommonRules: v.optional(v.picklist(["count", "block"]), "count"),
  /**
   * At most this many copies of the function run at once. Costs nothing, but off by default:
   * it comes out of the account's concurrency, and an account with a low limit refuses the deploy.
   */
  reservedConcurrency: v.optional(
    v.pipe(
      // A string from `-c reservedConcurrency=5`, a number from cdk.json. Number("") is 0 and Number("five") is NaN.
      v.union([v.number(), v.pipe(v.string(), v.transform(Number))], WHOLE),
      v.safeInteger(WHOLE),
      v.minValue(1, "must be 1 or more: 0 would stop the API"),
      v.maxValue(1000),
    ),
  ),
});
export type SecurityConfig = v.InferOutput<typeof securityConfigSchema>;

export function parseSecurityConfig(context: (key: string) => unknown): SecurityConfig {
  const result = v.safeParse(securityConfigSchema, {
    webAclArn: context("webAclArn"),
    cmk: context("cmk"),
    wafCommonRules: context("wafCommonRules"),
    reservedConcurrency: context("reservedConcurrency"),
  });
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid CDK context:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}
// #endregion context
