import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { GrafanaStack, type GrafanaStackProps, WORKSPACE_ACTIONS } from "../lib/grafana-stack.ts";

const synth = (props: Partial<GrafanaStackProps> = {}) =>
  Template.fromStack(
    new GrafanaStack(new App(), "AihGrafana", { env: { region: "ap-northeast-1" }, ...props }),
  );

const roleOnly = synth();
const withWorkspace = synth({ authentication: "AWS_SSO" });
const restricted = synth({ authentication: "SAML", prefixListIds: ["pl-0123456789abcdef0"] });

const types = (template: Template) => {
  const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
  return [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted();
};

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };

describe("by default", () => {
  it("creates nothing that is billed: a role and its policy", () => {
    expect(types(roleOnly)).toEqual(["AWS::IAM::Policy", "AWS::IAM::Role"]);
    expect(Object.keys(roleOnly.findOutputs("*"))).toEqual(["WorkspaceRoleArn"]);
  });
});

describe("the workspace role", () => {
  it("can be taken only by a Grafana workspace of this account and Region", () => {
    for (const template of [roleOnly, withWorkspace]) {
      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Effect: "Allow",
              Action: "sts:AssumeRole",
              Principal: { Service: "grafana.amazonaws.com" },
              Condition: {
                StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" } },
                ArnLike: {
                  "aws:SourceArn": {
                    "Fn::Join": [
                      "",
                      [
                        "arn:",
                        { Ref: "AWS::Partition" },
                        ":grafana:ap-northeast-1:",
                        { Ref: "AWS::AccountId" },
                        ":/workspaces/*",
                      ],
                    ],
                  },
                },
              },
            },
          ],
        },
        ManagedPolicyArns: Match.absent(),
      });
    }
  });

  it("reads metric data and nothing else: no logs, no alarms, no writes", () => {
    const statements = Object.values(withWorkspace.findResources("AWS::IAM::Policy")).flatMap(
      (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
    );
    expect(statements).toEqual([
      {
        Effect: "Allow",
        Action: ["cloudwatch:GetMetricData", "cloudwatch:ListMetrics"],
        Resource: "*",
      },
    ]);
    expect(WORKSPACE_ACTIONS.every((action) => !action.includes("*"))).toBe(true);
  });
});

describe("the workspace", () => {
  it("exists only once a way to sign in is chosen", () => {
    roleOnly.resourceCountIs("AWS::Grafana::Workspace", 0);
    withWorkspace.resourceCountIs("AWS::Grafana::Workspace", 1);
  });

  it("uses the role of this stack and lets the service add no permissions", () => {
    withWorkspace.hasResourceProperties("AWS::Grafana::Workspace", {
      AccountAccessType: "CURRENT_ACCOUNT",
      AuthenticationProviders: ["AWS_SSO"],
      PermissionType: "CUSTOMER_MANAGED",
      RoleArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^WorkspaceRole"), "Arn"] },
      DataSources: Match.absent(),
      NotificationDestinations: Match.absent(),
      OrganizationalUnits: Match.absent(),
    });
  });

  it("does not let workspace admins install plugins", () => {
    withWorkspace.hasResourceProperties("AWS::Grafana::Workspace", { PluginAdminEnabled: false });
  });

  it("is open to every address unless prefix lists are given, and then to those only", () => {
    withWorkspace.hasResourceProperties("AWS::Grafana::Workspace", {
      NetworkAccessControl: Match.absent(),
    });
    restricted.hasResourceProperties("AWS::Grafana::Workspace", {
      AuthenticationProviders: ["SAML"],
      NetworkAccessControl: { PrefixListIds: ["pl-0123456789abcdef0"], VpceIds: [] },
    });
  });

  it("leaves the version to the service unless one is given", () => {
    withWorkspace.hasResourceProperties("AWS::Grafana::Workspace", {
      GrafanaVersion: Match.absent(),
    });
    synth({ authentication: "SAML", grafanaVersion: "12.4" }).hasResourceProperties(
      "AWS::Grafana::Workspace",
      { GrafanaVersion: "12.4" },
    );
  });

  it("is deleted with the stack, dashboards included", () => {
    const [workspace] = Object.values(withWorkspace.findResources("AWS::Grafana::Workspace"));
    expect(workspace?.["DeletionPolicy"]).toBeUndefined();
    expect(Object.keys(withWorkspace.findOutputs("*")).toSorted()).toEqual([
      "WorkspaceEndpoint",
      "WorkspaceId",
      "WorkspaceRoleArn",
    ]);
  });
});

describe("the stack as a whole", () => {
  it("uses only resource types that were checked against the pinned cdkd", () => {
    expect(types(withWorkspace)).toEqual([
      // Cloud Control API in cdkd 0.296.28
      "AWS::Grafana::Workspace",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
    ]);
    expect(types(restricted)).toEqual(types(withWorkspace));
  });
});
