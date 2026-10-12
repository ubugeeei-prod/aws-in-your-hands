import * as v from "valibot";

export const APP_REGION = "ap-northeast-1";
/** CloudFront's web ACLs, its metrics, and Shield Advanced's metrics for it all live here. */
export const EDGE_REGION = "us-east-1";

// #region context
const WHOLE = "must be a whole number such as 20";

/** CDK context, as typed with `-c name=value`. Everything billed by the month starts off. */
export const shieldConfigSchema = v.pipe(
  v.object({
    allowedOrigin: v.optional(
      // v.url() alone would accept "localhost:5173" (scheme "localhost").
      v.pipe(v.string(), v.url(), v.regex(/^https?:\/\//, "Must be an http or https URL.")),
      "http://localhost:5173",
    ),
    /** The WebAclArn output of AihShieldEdge. Absent: the distribution has no web ACL. */
    webAclArn: v.optional(
      v.pipe(
        v.string(),
        v.regex(
          /^arn:aws:wafv2:us-east-1:\d{12}:global\/webacl\/[\w-]+\/[0-9a-f-]{36}$/,
          "must be a CLOUDFRONT-scope web ACL ARN: arn:aws:wafv2:us-east-1:<account>:global/webacl/<name>/<id>",
        ),
      ),
    ),
    /** Free, but off: it comes out of the account's concurrency, and a new account may have none to spare. */
    reservedConcurrency: v.optional(
      v.pipe(
        // A string from `-c reservedConcurrency=20`. Number("") is 0 and Number("twenty") is NaN.
        v.union([v.number(), v.pipe(v.string(), v.transform(Number))], WHOLE),
        v.safeInteger(WHOLE),
        v.minValue(1, "must be 1 or more: 0 stops the API, which is a decision for the runbook"),
        v.maxValue(1000),
      ),
    ),
    /**
     * `on` adds a Shield Advanced protection for the distribution. It does not subscribe the
     * account: that is done by hand, costs USD 3,000 a month, and is a commitment for a year.
     */
    shieldAdvanced: v.optional(v.picklist(["on", "off"]), "off"),
    /** The DistributionArn output of AihShield. */
    distributionArn: v.optional(
      v.pipe(
        v.string(),
        v.regex(
          /^arn:aws:cloudfront::\d{12}:distribution\/[A-Z0-9]+$/,
          "must be a distribution ARN: arn:aws:cloudfront::<account>:distribution/<id>",
        ),
      ),
    ),
    /** An SNS topic in us-east-1, where the alarms are. Notifying across Regions was not confirmed. */
    alarmTopicArn: v.optional(
      v.pipe(
        v.string(),
        v.regex(
          /^arn:aws:sns:us-east-1:\d{12}:[A-Za-z0-9_-]+$/,
          "must be an SNS topic in us-east-1: arn:aws:sns:us-east-1:<account>:<name>",
        ),
      ),
    ),
  }),
  v.check(
    (config) => config.shieldAdvanced === "off" || config.distributionArn !== undefined,
    "shieldAdvanced=on needs -c distributionArn=<the DistributionArn output of AihShield>",
  ),
);
export type ShieldConfig = v.InferOutput<typeof shieldConfigSchema>;

export function parseShieldConfig(context: (key: string) => unknown): ShieldConfig {
  const result = v.safeParse(shieldConfigSchema, {
    allowedOrigin: context("allowedOrigin"),
    webAclArn: context("webAclArn"),
    reservedConcurrency: context("reservedConcurrency"),
    shieldAdvanced: context("shieldAdvanced"),
    distributionArn: context("distributionArn"),
    alarmTopicArn: context("alarmTopicArn"),
  });
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid CDK context:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}
// #endregion context
