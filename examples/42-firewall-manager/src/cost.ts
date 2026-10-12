import type { Scenario } from "@aih/tools/pricing/schema.ts";

// #region shape
/** What the bill depends on. Every number here is an assumption the caller states, not a measurement. */
export type OrganizationShape = {
  /** Accounts in the OUs the two policies name. */
  accountsInScope: number;
  /** Accounts where AWS Config has to record: the ones in scope and the administrator account. */
  accountsRecorded: number;
  /** In-scope accounts with at least one distribution, so with one managed web ACL each. */
  accountsWithWebAcl: number;
  /** Rule groups of the policy. Each is counted as one rule of each web ACL. */
  ruleGroupsPerWebAcl: number;
  requestsPerWebAcl: number;
  /** Configuration items a month per account: us-east-1 for CloudFront, ap-northeast-1 for security groups. */
  configItemsPerAccount: { usEast1: number; apNortheast1: number };
  /** Evaluations a month of the AWS Config rule each policy creates in each account in scope. */
  ruleEvaluationsPerAccount: number;
};

export const SMALL_ORGANIZATION: OrganizationShape = {
  accountsInScope: 3,
  accountsRecorded: 4,
  accountsWithWebAcl: 3,
  ruleGroupsPerWebAcl: 2,
  requestsPerWebAcl: 1_000_000,
  configItemsPerAccount: { usEast1: 20, apNortheast1: 200 },
  ruleEvaluationsPerAccount: 100,
};
// #endregion shape

// #region items
/** The two policies of this chapter, and what they cause to exist in the accounts they cover. */
export function monthlyItems(shape: OrganizationShape): Scenario["items"] {
  const acls = shape.accountsWithWebAcl;
  return [
    {
      priceId: "fms.policy.global.wafv2",
      quantity: 1,
      basis: "1 AWS WAF policy for CloudFront (Global)",
    },
    {
      priceId: "fms.policy.apne1.sg-content-audit",
      quantity: 1,
      basis: "1 security group content audit policy in ap-northeast-1",
    },
    { priceId: "waf.global.webacl", quantity: acls, basis: `${acls} accounts x 1 managed web ACL` },
    {
      priceId: "waf.global.rule",
      quantity: acls * shape.ruleGroupsPerWebAcl,
      basis: `${acls} web ACLs x ${shape.ruleGroupsPerWebAcl} rule groups`,
    },
    {
      priceId: "waf.global.request",
      quantity: acls * shape.requestsPerWebAcl,
      basis: `${acls} web ACLs x ${shape.requestsPerWebAcl} requests inspected`,
    },
    {
      priceId: "config.use1.item.continuous",
      quantity: shape.accountsRecorded * shape.configItemsPerAccount.usEast1,
      basis: `${shape.accountsRecorded} accounts x ${shape.configItemsPerAccount.usEast1} items in us-east-1`,
    },
    {
      priceId: "config.item.continuous",
      quantity: shape.accountsRecorded * shape.configItemsPerAccount.apNortheast1,
      basis: `${shape.accountsRecorded} accounts x ${shape.configItemsPerAccount.apNortheast1} items in ap-northeast-1`,
    },
    {
      priceId: "config.use1.rule.evaluation",
      quantity: shape.accountsInScope * shape.ruleEvaluationsPerAccount,
      basis: `${shape.accountsInScope} accounts x ${shape.ruleEvaluationsPerAccount} evaluations (AWS WAF policy)`,
    },
    {
      priceId: "config.rule.evaluation",
      quantity: shape.accountsInScope * shape.ruleEvaluationsPerAccount,
      basis: `${shape.accountsInScope} accounts x ${shape.ruleEvaluationsPerAccount} evaluations (audit policy)`,
    },
  ];
}
// #endregion items

// #region unknown
/** Not in the sum, and not zero: nothing here was confirmed well enough to put a number on. */
export const NOT_IN_THE_SUM = [
  "Security Hub CSPM, which the findings travel through",
  "S3 storage for the configuration history AWS Config delivers",
  "whether the policy fee is prorated for a policy that exists for part of a month",
  "how the rule groups Firewall Manager places in a member web ACL are metered (counted here as one rule each)",
  "the notifier's Lambda, SNS, EventBridge, and CloudWatch Logs usage",
] as const;
// #endregion unknown
