// The two policies, as data. The CDK stacks and the local evaluators both read this file,
// so the scope a test reasons about is the scope a deploy would create.

import {
  awsManagedRuleGroup,
  type ContentAuditData,
  type WafV2Data,
} from "./managed-service-data.ts";
import type { PolicyScopeInput } from "./scope.ts";
import type { AllowedRange } from "./security-group-audit.ts";

// #region exemptions
// The only way out of each policy: this exact key and value on the resource itself.
// A tag matches on key and value together, so `fms-waf=Exempt` exempts nothing.
export const WAF_EXEMPT_TAG = { key: "fms-waf", value: "exempt" } as const;
export const SG_AUDIT_EXEMPT_TAG = { key: "fms-sg-audit", value: "exempt" } as const;
// #endregion exemptions

// #region edge-waf
export const EDGE_WAF_POLICY_NAME = "aih-edge-waf";

/** Every CloudFront distribution in the named OUs, including ones that do not exist yet. */
export const edgeWafScope = (orgUnits: readonly string[]): PolicyScopeInput => ({
  includeMap: { orgUnits: [...orgUnits] },
  resourceTypes: ["AWS::CloudFront::Distribution"],
  resourceTags: [WAF_EXEMPT_TAG],
  excludeResourceTags: true,
  resourceTagLogicalOperator: "AND",
});

// Web ACL capacity units, from the AWS Managed Rules pages read 2026-10-13.
export const RULE_GROUP_WCU: Readonly<Record<string, number>> = {
  AWSManagedRulesAmazonIpReputationList: 25,
  AWSManagedRulesKnownBadInputsRuleSet: 200,
};

export const edgeWafData = (options: { replaceAccountWebAcls: boolean }): WafV2Data => ({
  type: "WAFV2",
  // First: evaluated before anything an account owner adds, so no account rule can let these through.
  preProcessRuleGroups: [awsManagedRuleGroup("AWSManagedRulesAmazonIpReputationList")],
  // Last: reached only by requests that no account rule has already allowed or blocked.
  postProcessRuleGroups: [awsManagedRuleGroup("AWSManagedRulesKnownBadInputsRuleSet")],
  defaultAction: { type: "ALLOW" },
  overrideCustomerWebACLAssociation: options.replaceAccountWebAcls,
  optimizeUnassociatedWebACL: true,
});
// #endregion edge-waf

// #region sg-audit
export const SG_AUDIT_POLICY_NAME = "aih-ingress-audit";

export const sgAuditScope = (orgUnits: readonly string[]): PolicyScopeInput => ({
  includeMap: { orgUnits: [...orgUnits] },
  resourceTypes: ["AWS::EC2::SecurityGroup"],
  resourceTags: [SG_AUDIT_EXEMPT_TAG],
  excludeResourceTags: true,
  resourceTagLogicalOperator: "AND",
});

/**
 * The inbound rules of the audit security group. With the ALLOW action, an inbound rule
 * anywhere in scope has to fit inside one of these: HTTPS from anywhere, and anything
 * from the private address blocks of RFC 1918.
 */
export const AUDIT_ALLOWED: readonly AllowedRange[] = [
  {
    protocol: "tcp",
    fromPort: 443,
    toPort: 443,
    cidr: "0.0.0.0/0",
    description: "HTTPS from any IPv4 address",
  },
  {
    protocol: "tcp",
    fromPort: 443,
    toPort: 443,
    cidr: "::/0",
    description: "HTTPS from any IPv6 address",
  },
  { protocol: "all", cidr: "10.0.0.0/8", description: "anything from 10.0.0.0/8" },
  { protocol: "all", cidr: "172.16.0.0/12", description: "anything from 172.16.0.0/12" },
  { protocol: "all", cidr: "192.168.0.0/16", description: "anything from 192.168.0.0/16" },
];

export const sgAuditData = (auditSecurityGroupId: string): ContentAuditData => ({
  type: "SECURITY_GROUPS_CONTENT_AUDIT",
  securityGroups: [{ id: auditSecurityGroupId }],
  securityGroupAction: { type: "ALLOW" },
});
// #endregion sg-audit
