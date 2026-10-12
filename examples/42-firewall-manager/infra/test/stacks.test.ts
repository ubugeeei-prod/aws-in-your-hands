import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { lintTemplate } from "@aih/example-21-security/src/iam-lint.ts";

import { parseFirewallConfig } from "../lib/config.ts";
import { EdgeWafPolicyStack } from "../lib/edge-waf-policy-stack.ts";
import {
  FirewallManagerStack,
  type FirewallManagerStackProps,
} from "../lib/firewall-manager-stack.ts";

// Example values: the account ID AWS uses in its documentation, and an OU ID of the documented shape.
const ADMIN = "111122223333";
const OUS = ["ou-ex42-workload1"];

const regional = (props: Partial<FirewallManagerStackProps> = {}) =>
  Template.fromStack(
    new FirewallManagerStack(new App({ analyticsReporting: false }), "AihFirewallManager", {
      env: { region: "ap-northeast-1" },
      adminAccountId: ADMIN,
      orgUnitIds: OUS,
      remediation: false,
      ...props,
    }),
  );
const edge = (region = "us-east-1", remediation = false, replaceAccountWebAcls = false) =>
  Template.fromStack(
    new EdgeWafPolicyStack(new App({ analyticsReporting: false }), "AihFirewallManagerEdge", {
      env: { region },
      orgUnitIds: OUS,
      remediation,
      replaceAccountWebAcls,
    }),
  );
const typesOf = (template: Template) =>
  Object.values(template.toJSON()["Resources"] as Record<string, { Type: string }>)
    .map((resource) => resource.Type)
    .toSorted();

const scope = {
  IncludeMap: { ORGUNIT: OUS },
  ExcludeMap: Match.absent(),
  ExcludeResourceTags: true,
  ResourceTagLogicalOperator: "AND",
};

describe("AihFirewallManagerEdge", () => {
  const template = edge();

  it("can only be placed in us-east-1", () => {
    expect(() => edge("ap-northeast-1")).toThrow(/us-east-1/);
  });

  it("is one policy and nothing else", () => {
    // cdkd 0.296.28 has no provider of its own for AWS::FMS::Policy: it goes through Cloud Control.
    expect(typesOf(template)).toEqual(["AWS::FMS::Policy"]);
  });

  it("covers every CloudFront distribution in the OUs, except the ones tagged exempt", () => {
    template.hasResourceProperties("AWS::FMS::Policy", {
      ...scope,
      PolicyName: "aih-edge-waf",
      ResourceType: "AWS::CloudFront::Distribution",
      ResourceTypeList: Match.absent(),
      ResourceTags: [{ Key: "fms-waf", Value: "exempt" }],
    });
  });

  it("reports only, until remediation is asked for", () => {
    template.hasResourceProperties("AWS::FMS::Policy", { RemediationEnabled: false });
    edge("us-east-1", true).hasResourceProperties("AWS::FMS::Policy", {
      RemediationEnabled: true,
    });
  });

  it("carries the rule groups as one JSON string of the documented shape", () => {
    const [policy] = Object.values(template.findResources("AWS::FMS::Policy"));
    const data = policy?.["Properties"].SecurityServicePolicyData as Record<string, string>;
    expect(data["Type"]).toBe("WAFV2");
    const parsed = JSON.parse(data["ManagedServiceData"] ?? "") as Record<string, unknown>;
    expect(parsed["type"]).toBe("WAFV2");
    expect(parsed["optimizeUnassociatedWebACL"]).toBe(true);
    expect(parsed["overrideCustomerWebACLAssociation"]).toBe(false);
    const replaced = Object.values(edge("us-east-1", true, true).findResources("AWS::FMS::Policy"));
    expect(
      replaced[0]?.["Properties"].SecurityServicePolicyData.ManagedServiceData as string,
    ).toContain('"overrideCustomerWebACLAssociation":true');
  });

  it("takes its web ACLs with it when it leaves a scope or is deleted", () => {
    template.hasResourceProperties("AWS::FMS::Policy", {
      ResourcesCleanUp: true,
      DeleteAllPolicyResources: true,
    });
  });
});

describe("AihFirewallManager", () => {
  const template = regional();

  it("uses these resource types and no others", () => {
    // In cdkd 0.296.28, the two AWS::FMS types go through Cloud Control. The others have providers.
    expect(typesOf(template)).toEqual([
      "AWS::EC2::SecurityGroup",
      "AWS::EC2::VPC",
      "AWS::Events::Rule",
      "AWS::FMS::NotificationChannel",
      "AWS::FMS::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
      "AWS::SNS::Topic",
      "AWS::SNS::TopicPolicy",
    ]);
  });

  it("audits every security group in the OUs, except the ones tagged exempt", () => {
    template.hasResourceProperties("AWS::FMS::Policy", {
      ...scope,
      PolicyName: "aih-ingress-audit",
      ResourceType: "AWS::EC2::SecurityGroup",
      ResourceTags: [{ Key: "fms-sg-audit", Value: "exempt" }],
      RemediationEnabled: false,
    });
  });

  it("points the policy at the audit security group of this stack", () => {
    const [policy] = Object.values(template.findResources("AWS::FMS::Policy"));
    expect(policy?.["Properties"].SecurityServicePolicyData).toEqual({
      Type: "SECURITY_GROUPS_CONTENT_AUDIT",
      ManagedServiceData: {
        "Fn::Join": [
          "",
          [
            '{"type":"SECURITY_GROUPS_CONTENT_AUDIT","securityGroups":[{"id":"',
            { "Fn::GetAtt": ["AuditGroup", "GroupId"] },
            '"}],"securityGroupAction":{"type":"ALLOW"}}',
          ],
        ],
      },
    });
  });

  it("allows in the audit group what the local auditor allows, and nothing else", () => {
    template.hasResourceProperties("AWS::EC2::SecurityGroup", {
      SecurityGroupIngress: [
        Match.objectLike({ IpProtocol: "tcp", FromPort: 443, ToPort: 443, CidrIp: "0.0.0.0/0" }),
        Match.objectLike({ IpProtocol: "tcp", FromPort: 443, ToPort: 443, CidrIpv6: "::/0" }),
        Match.objectLike({ IpProtocol: "-1", CidrIp: "10.0.0.0/8" }),
        Match.objectLike({ IpProtocol: "-1", CidrIp: "172.16.0.0/12" }),
        Match.objectLike({ IpProtocol: "-1", CidrIp: "192.168.0.0/16" }),
      ],
    });
  });

  it("puts nothing in the audit VPC: no subnet, no gateway, nothing billed by the hour", () => {
    const types = typesOf(template);
    for (const type of ["AWS::EC2::Subnet", "AWS::EC2::InternetGateway", "AWS::EC2::NatGateway"]) {
      expect(types).not.toContain(type);
    }
  });

  it("lets the service-linked role of the administrator account publish, and nobody else", () => {
    const role = `arn:aws:iam::${ADMIN}:role/aws-service-role/fms.amazonaws.com/AWSServiceRoleForFMS`;
    template.hasResourceProperties("AWS::SNS::TopicPolicy", {
      PolicyDocument: {
        Statement: [
          {
            Sid: "AWSFirewallManagerSNSPolicy",
            Effect: "Allow",
            Principal: { AWS: role },
            Action: "sns:Publish",
            Resource: { Ref: Match.stringLikeRegexp("^ComplianceTopic") },
          },
        ],
      },
    });
    template.hasResourceProperties("AWS::FMS::NotificationChannel", { SnsRoleName: role });
  });

  it("sends Firewall Manager findings, and only those, to the notifier", () => {
    template.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: {
        source: ["aws.securityhub"],
        "detail-type": ["Security Hub Findings - Imported"],
        detail: { findings: { ProductName: ["Firewall Manager"] } },
      },
      Targets: [Match.objectLike({ Arn: { "Fn::GetAtt": [Match.anyValue(), "Arn"] } })],
    });
  });

  it("gives the notifier its own log group and one topic to publish to", () => {
    const [role] = Object.values(template.findResources("AWS::IAM::Role"));
    const statements = role?.["Properties"].Policies[0].PolicyDocument.Statement as {
      Action: string | string[];
    }[];
    expect(statements.flatMap((statement) => statement.Action)).toEqual([
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "sns:Publish",
    ]);
    expect(role?.["Properties"].ManagedPolicyArns).toBeUndefined();
    // Chapter 21's lint: no wildcard action, no wildcard resource.
    expect(lintTemplate(template.toJSON(), [])).toEqual({ findings: [], unusedExceptions: [] });
  });

  it("subscribes an address only when one is given", () => {
    template.resourceCountIs("AWS::SNS::Subscription", 0);
    regional({ notifyEmail: "oncall@example.com" }).hasResourceProperties(
      "AWS::SNS::Subscription",
      { Protocol: "email", Endpoint: "oncall@example.com" },
    );
  });

  it("keeps descriptions inside the characters the policy resource accepts", () => {
    for (const stack of [template, edge()]) {
      for (const policy of Object.values(stack.findResources("AWS::FMS::Policy"))) {
        expect(policy["Properties"].PolicyDescription).toMatch(/^[a-zA-Z0-9_.:/=+\-@\s]{1,256}$/);
        expect(policy["Properties"].PolicyName).toMatch(/^[a-zA-Z0-9_.:/=+\-@\s]+$/);
      }
    }
  });

  it("removes its log group with the stack", () => {
    template.hasResource("AWS::Logs::LogGroup", { DeletionPolicy: "Delete" });
  });
});

describe("the CDK context", () => {
  const parse = (context: Record<string, unknown>) => parseFirewallConfig((key) => context[key]);
  const required = { adminAccountId: ADMIN, orgUnitIds: "ou-ex42-workload1, ou-ex42-prodprod" };

  it("has no default for the account or the OUs", () => {
    expect(() => parse({})).toThrow(/adminAccountId: is required[\s\S]*orgUnitIds: is required/);
    expect(() => parse({ adminAccountId: ADMIN })).toThrow(/orgUnitIds/);
  });

  it("reads several OUs and starts with every remediation off", () => {
    expect(parse(required)).toEqual({
      adminAccountId: ADMIN,
      orgUnitIds: ["ou-ex42-workload1", "ou-ex42-prodprod"],
      wafRemediation: "off",
      replaceAccountWebAcls: "off",
      sgRemediation: "off",
    });
  });

  it("stops on a value that is nearly right", () => {
    expect(() => parse({ ...required, adminAccountId: 111122223333 })).toThrow(/adminAccountId/);
    expect(() => parse({ ...required, adminAccountId: "1111-2222-3333" })).toThrow(/12-digit/);
    expect(() => parse({ ...required, orgUnitIds: "o-exampleorgid" })).toThrow(/OU ID/);
    expect(() => parse({ ...required, wafRemediation: "true" })).toThrow(/wafRemediation/);
    expect(() => parse({ ...required, replaceAccountWebAcls: "on" })).toThrow(
      /needs wafRemediation/,
    );
  });
});
