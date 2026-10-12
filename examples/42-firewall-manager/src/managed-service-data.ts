// AWS::FMS::Policy takes the settings of each policy type as one JSON string,
// SecurityServicePolicyData.ManagedServiceData. The schemas below cover the fields this
// chapter sets, in the shape of the examples in the API reference. They catch a typo before
// a deploy. They are not the service's validation, which may accept more and refuse more.

import * as v from "valibot";

// #region waf-data
const managedRuleGroup = v.strictObject({
  ruleGroupType: v.literal("ManagedRuleGroup"),
  ruleGroupArn: v.null(),
  managedRuleGroupIdentifier: v.strictObject({
    vendorName: v.literal("AWS"),
    managedRuleGroupName: v.pipe(v.string(), v.regex(/^AWSManagedRules[A-Za-z]+$/)),
    // null: the default version of the managed rule group.
    version: v.null(),
  }),
  // NONE lets the rule group's own actions stand. It is the only value the WAFV2 examples show.
  overrideAction: v.strictObject({ type: v.literal("NONE") }),
  excludeRules: v.pipe(v.array(v.never()), v.length(0)),
});

/** The quotas page, read 2026-10-13: 50 rule groups per AWS WAF policy by default. */
export const MAX_RULE_GROUPS_PER_POLICY = 50;

export const wafV2DataSchema = v.pipe(
  v.strictObject({
    type: v.literal("WAFV2"),
    preProcessRuleGroups: v.array(managedRuleGroup),
    postProcessRuleGroups: v.array(managedRuleGroup),
    defaultAction: v.strictObject({ type: v.picklist(["ALLOW", "BLOCK"]) }),
    /** true: with remediation on, replace a web ACL the account had associated itself. */
    overrideCustomerWebACLAssociation: v.boolean(),
    /** true: no web ACL in an account until one of its resources will use it. */
    optimizeUnassociatedWebACL: v.boolean(),
  }),
  v.check(
    (data) =>
      data.preProcessRuleGroups.length + data.postProcessRuleGroups.length <=
      MAX_RULE_GROUPS_PER_POLICY,
    `has more than ${MAX_RULE_GROUPS_PER_POLICY} rule groups`,
  ),
  v.check(
    (data) => data.preProcessRuleGroups.length + data.postProcessRuleGroups.length > 0,
    "has no rule group: the policy would enforce nothing",
  ),
);
export type WafV2Data = v.InferOutput<typeof wafV2DataSchema>;

export const awsManagedRuleGroup = (
  managedRuleGroupName: string,
): WafV2Data["preProcessRuleGroups"][number] => ({
  ruleGroupType: "ManagedRuleGroup",
  ruleGroupArn: null,
  managedRuleGroupIdentifier: { vendorName: "AWS", managedRuleGroupName, version: null },
  overrideAction: { type: "NONE" },
  excludeRules: [],
});
// #endregion waf-data

// #region audit-data
const SECURITY_GROUP_ID = /^sg-[0-9a-f]{8,17}$/;

/**
 * `isDeployTimeValue` lets a CloudFormation reference through: in a CDK stack the ID of
 * the audit security group is a token until the deploy, and no pattern can check it.
 */
export const contentAuditDataSchema = (isDeployTimeValue: (id: string) => boolean = () => false) =>
  v.strictObject({
    type: v.literal("SECURITY_GROUPS_CONTENT_AUDIT"),
    // One audit security group per policy is the default quota.
    securityGroups: v.pipe(
      v.array(
        v.strictObject({
          id: v.pipe(
            v.string(),
            v.check(
              (id) => SECURITY_GROUP_ID.test(id) || isDeployTimeValue(id),
              "must be a security group ID such as sg-0123456789abcdef0",
            ),
          ),
        }),
      ),
      v.length(1),
    ),
    // ALLOW: every in-scope rule must be within the range of the audit group's rules.
    // DENY: no in-scope rule may match one of them.
    securityGroupAction: v.strictObject({ type: v.picklist(["ALLOW", "DENY"]) }),
  });
export type ContentAuditData = v.InferOutput<ReturnType<typeof contentAuditDataSchema>>;
// #endregion audit-data

// #region encode
/** ManagedServiceData is at most 30,000 characters and may not contain an escaped line break. */
const MAX_LENGTH = 30_000;

export function encode<Schema extends v.GenericSchema>(schema: Schema, data: unknown): string {
  const result = v.safeParse(schema, data);
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid managed service data:\n  ${problems.join("\n  ")}`);
  }
  const text = JSON.stringify(result.output);
  if (text.length > MAX_LENGTH || /\\[nr]/.test(text)) {
    throw new Error("Managed service data is too long or contains a line break");
  }
  return text;
}
// #endregion encode
