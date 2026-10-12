import { describe, expect, it } from "vite-plus/test";

import {
  contentAuditDataSchema,
  encode,
  MAX_RULE_GROUPS_PER_POLICY,
  awsManagedRuleGroup,
  wafV2DataSchema,
} from "../src/managed-service-data.ts";
import { edgeWafData, RULE_GROUP_WCU, sgAuditData } from "../src/policies.ts";

const waf = edgeWafData({ replaceAccountWebAcls: false });

describe("the AWS WAF policy's managed service data", () => {
  it("is the JSON the API reference shows, field for field", () => {
    expect(JSON.parse(encode(wafV2DataSchema, waf))).toEqual({
      type: "WAFV2",
      preProcessRuleGroups: [
        {
          ruleGroupType: "ManagedRuleGroup",
          ruleGroupArn: null,
          managedRuleGroupIdentifier: {
            vendorName: "AWS",
            managedRuleGroupName: "AWSManagedRulesAmazonIpReputationList",
            version: null,
          },
          overrideAction: { type: "NONE" },
          excludeRules: [],
        },
      ],
      postProcessRuleGroups: [
        {
          ruleGroupType: "ManagedRuleGroup",
          ruleGroupArn: null,
          managedRuleGroupIdentifier: {
            vendorName: "AWS",
            managedRuleGroupName: "AWSManagedRulesKnownBadInputsRuleSet",
            version: null,
          },
          overrideAction: { type: "NONE" },
          excludeRules: [],
        },
      ],
      defaultAction: { type: "ALLOW" },
      overrideCustomerWebACLAssociation: false,
      optimizeUnassociatedWebACL: true,
    });
  });

  it("stays inside the capacity a policy and a web ACL's base price allow", () => {
    const names = [...waf.preProcessRuleGroups, ...waf.postProcessRuleGroups].map(
      (group) => group.managedRuleGroupIdentifier.managedRuleGroupName,
    );
    const capacity = names.map((name) => RULE_GROUP_WCU[name]);
    // A rule group whose capacity nobody looked up is not one to roll out to every account.
    expect(capacity).not.toContain(undefined);
    const total = capacity.reduce<number>((sum, units) => sum + (units ?? 0), 0);
    expect(total).toBe(225);
    // 5,000 is the fixed quota per policy; past 1,500 a web ACL's requests cost more.
    expect(total).toBeLessThanOrEqual(1500);
  });

  it("refuses a misspelled key instead of sending it", () => {
    const { overrideCustomerWebACLAssociation, ...rest } = waf;
    const typo = { ...rest, overrideCustomerWebAclAssociation: overrideCustomerWebACLAssociation };
    expect(() => encode(wafV2DataSchema, typo)).toThrow(/Invalid managed service data/);
  });

  it("refuses values this chapter has not confirmed for a WAFV2 policy", () => {
    const counted = {
      ...waf,
      preProcessRuleGroups: [
        {
          ...awsManagedRuleGroup("AWSManagedRulesCommonRuleSet"),
          overrideAction: { type: "COUNT" },
        },
      ],
    };
    expect(() => encode(wafV2DataSchema, counted)).toThrow(/overrideAction/);
  });

  it("refuses a policy with no rule group, and one with more than the quota", () => {
    const none = { ...waf, preProcessRuleGroups: [], postProcessRuleGroups: [] };
    const many = {
      ...waf,
      preProcessRuleGroups: Array.from({ length: MAX_RULE_GROUPS_PER_POLICY }, () =>
        awsManagedRuleGroup("AWSManagedRulesAmazonIpReputationList"),
      ),
    };
    expect(() => encode(wafV2DataSchema, none)).toThrow(/enforce nothing/);
    expect(() => encode(wafV2DataSchema, many)).toThrow(/more than 50/);
  });
});

describe("the audit policy's managed service data", () => {
  it("names one audit security group and the ALLOW action", () => {
    expect(encode(contentAuditDataSchema(), sgAuditData("sg-0123456789abcdef0"))).toBe(
      '{"type":"SECURITY_GROUPS_CONTENT_AUDIT","securityGroups":[{"id":"sg-0123456789abcdef0"}],' +
        '"securityGroupAction":{"type":"ALLOW"}}',
    );
  });

  it("refuses anything that is not a security group ID, unless the caller vouches for it", () => {
    const reference = "a value CloudFormation fills in";
    expect(() => encode(contentAuditDataSchema(), sgAuditData("vpc-0123456789abcdef0"))).toThrow(
      /security group ID/,
    );
    expect(() => encode(contentAuditDataSchema(), sgAuditData(reference))).toThrow();
    expect(
      encode(
        contentAuditDataSchema((id) => id === reference),
        sgAuditData(reference),
      ),
    ).toContain(reference);
  });

  it("refuses a second audit security group, which the default quota does not allow", () => {
    const two = {
      ...sgAuditData("sg-0123456789abcdef0"),
      securityGroups: [{ id: "sg-0123456789abcdef0" }, { id: "sg-0fedcba9876543210" }],
    };
    expect(() => encode(contentAuditDataSchema(), two)).toThrow();
  });
});

describe("encoding", () => {
  it("refuses a line break, which the ManagedServiceData pattern does not allow", () => {
    const schema = contentAuditDataSchema(() => true);
    expect(() => encode(schema, sgAuditData("sg-0123456789abcdef0\n"))).toThrow(/line break/);
  });
});
