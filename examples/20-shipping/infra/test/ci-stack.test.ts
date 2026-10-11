import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";
import { CiStack, GITHUB_ISSUER, githubSubjects } from "../lib/ci-stack.ts";
import { ciConfigSchema, parseShipConfig } from "../lib/config.ts";

const synth = (input: Record<string, string>) => {
  const ci = ciConfigSchema.parse(input);
  const stack = new CiStack(new App({ analyticsReporting: false }), "AihShipCi", {
    env: { region: "ap-northeast-1" },
    ci,
  });
  return { ci, template: Template.fromStack(stack) };
};

const { ci, template } = synth({ githubRepository: "octo-org/octo-repo" });

type Statement = { Sid?: string; Effect: string; Action: string | string[]; Resource: unknown };
type Trust = {
  Statement: {
    Effect: string;
    Action: string;
    Principal: Record<string, unknown>;
    Condition: Record<string, Record<string, unknown>>;
  }[];
};
type RoleProperties = {
  AssumeRolePolicyDocument: Trust;
  MaxSessionDuration: number;
  ManagedPolicyArns?: unknown;
  Policies: { PolicyDocument: { Statement: Statement[] } }[];
};

const roles = (from: Template = template) =>
  Object.fromEntries(
    Object.entries(from.findResources("AWS::IAM::Role")).map(([logicalId, role]) => [
      logicalId.replace(/[0-9A-F]{8}$/, ""),
      role["Properties"] as RoleProperties,
    ]),
  );
const statements = (role: RoleProperties | undefined) =>
  (role?.Policies ?? []).flatMap((policy) => policy.PolicyDocument.Statement);
const actions = (role: RoleProperties | undefined) => statements(role).flatMap((statement) => statement.Action);

describe("trust policies", () => {
  it("each role trusts one exact subject of one repository, and STS as the audience", () => {
    const expected: Record<string, string> = {
      PlanRole: "repo:octo-org/octo-repo:pull_request",
      DeployRole: "repo:octo-org/octo-repo:environment:production",
      PreviewRole: "repo:octo-org/octo-repo:environment:preview",
      DriftRole: "repo:octo-org/octo-repo:ref:refs/heads/main",
    };
    expect(Object.keys(roles()).toSorted()).toEqual(Object.keys(expected).toSorted());

    for (const [name, role] of Object.entries(roles())) {
      const trust = role.AssumeRolePolicyDocument.Statement;
      expect(trust, name).toHaveLength(1);
      expect(trust[0]).toMatchObject({ Effect: "Allow", Action: "sts:AssumeRoleWithWebIdentity" });
      expect(Object.keys(trust[0]?.Principal ?? {})).toEqual(["Federated"]);
      // StringEquals only. A StringLike here is how a role ends up open to every branch.
      expect(trust[0]?.Condition).toEqual({
        StringEquals: { [`${GITHUB_ISSUER}:aud`]: "sts.amazonaws.com", [`${GITHUB_ISSUER}:sub`]: expected[name] },
      });
      expect(role.MaxSessionDuration).toBe(3600);
    }
  });

  it("only production deploys from the protected environment, and no role trusts a bare branch for deploys", () => {
    const subjects = githubSubjects(ci);
    expect(new Set(Object.values(subjects)).size).toBe(4);
    expect(subjects.deploy).not.toContain(":ref:");
    expect(subjects.plan).not.toContain("environment");
  });

  it("carries immutable subject claims through unchanged", () => {
    const immutable = synth({ githubRepository: "octo-org@123456/octo-repo@456789", deployBranch: "release" });
    const trust = roles(immutable.template)["DriftRole"]?.AssumeRolePolicyDocument.Statement[0];
    expect(trust?.Condition["StringEquals"]?.[`${GITHUB_ISSUER}:sub`]).toBe(
      "repo:octo-org@123456/octo-repo@456789:ref:refs/heads/release",
    );
  });

  it.each([
    { githubRepository: "octo-org/*" },
    { githubRepository: "*/octo-repo" },
    { githubRepository: "octo-org" },
    { githubRepository: "octo-org/octo-repo:ref:refs/heads/main" },
    { githubRepository: "octo-org/octo-repo", deployBranch: "*" },
    { githubRepository: "octo-org/octo-repo", deployBranch: "release/?" },
    { githubRepository: "octo-org/octo-repo", productionEnvironment: "prod*" },
    {
      githubRepository: "octo-org/octo-repo",
      existingOidcProviderArn: "arn:aws:iam::111111111111:oidc-provider/evil.example",
    },
  ])("refuses context that would widen or redirect trust: %j", (input) => {
    expect(ciConfigSchema.safeParse(input).success).toBe(false);
  });

  it("fails synthesis when no repository is named", () => {
    expect(() => parseShipConfig(() => undefined)).toThrow("ci.githubRepository");
  });
});

describe("OIDC provider", () => {
  it("registers GitHub's issuer for STS and nothing else", () => {
    template.resourceCountIs("AWS::IAM::OIDCProvider", 1);
    template.hasResource("AWS::IAM::OIDCProvider", {
      Properties: { Url: "https://token.actions.githubusercontent.com", ClientIdList: ["sts.amazonaws.com"] },
      DeletionPolicy: "Delete",
    });
  });

  it("reuses an existing provider instead of creating a second one", () => {
    const arn = "arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com";
    const reused = synth({ githubRepository: "octo-org/octo-repo", existingOidcProviderArn: arn });
    reused.template.resourceCountIs("AWS::IAM::OIDCProvider", 0);
    for (const role of Object.values(roles(reused.template))) {
      expect(role.AssumeRolePolicyDocument.Statement[0]?.Principal).toEqual({ Federated: arn });
    }
  });
});

describe("permissions", () => {
  const bootstrapKinds = (role: RoleProperties | undefined) =>
    statements(role)
      .filter((statement) => statement.Action === "sts:AssumeRole")
      .flatMap((statement) => [...JSON.stringify(statement.Resource).matchAll(/cdk-hnb659fds-([a-z-]+)-role-/g)])
      .map((match) => match[1])
      .toSorted();

  it("the pull request role can only read, through the lookup role", () => {
    expect(actions(roles()["PlanRole"])).toEqual(["sts:AssumeRole"]);
    expect(bootstrapKinds(roles()["PlanRole"])).toEqual(["lookup"]);
  });

  it("the deploy roles reach CloudFormation only through the bootstrap roles", () => {
    for (const name of ["DeployRole", "PreviewRole"]) {
      expect(actions(roles()[name]).toSorted(), name).toEqual(["cloudformation:DescribeStacks", "sts:AssumeRole"]);
      expect(bootstrapKinds(roles()[name])).toEqual(["deploy", "file-publishing"]);
    }
  });

  it("the drift role cannot change anything", () => {
    const readOnly =
      /^(cloudformation:(Detect|Describe|List|BatchDescribe)|lambda:Get|iam:(Get|List)|apigateway:GET$|logs:(Describe|List|Get))/;
    const driftActions = actions(roles()["DriftRole"]);
    expect(driftActions.length).toBeGreaterThan(10);
    for (const action of driftActions) {
      expect(action).toMatch(readOnly);
    }
    expect(driftActions).not.toContain("sts:AssumeRole");
  });

  it("uses a wildcard resource only for actions that have no resource-level form", () => {
    const wildcard = Object.values(roles())
      .flatMap(statements)
      .filter((statement) => JSON.stringify(statement.Resource) === '"*"');
    expect(wildcard.flatMap((statement) => statement.Action).toSorted()).toEqual([
      "cloudformation:BatchDescribeTypeConfigurations",
      "cloudformation:DescribeStackDriftDetectionStatus",
      "logs:DescribeIndexPolicies",
      "logs:DescribeLogGroups",
      "logs:DescribeResourcePolicies",
    ]);
    for (const action of Object.values(roles()).flatMap(actions)) {
      expect(action).not.toContain("*");
    }
  });

  it("attaches no managed policy and keeps every permission on the role itself", () => {
    for (const role of Object.values(roles())) {
      expect(role.ManagedPolicyArns).toBeUndefined();
    }
    const types = Object.values(template.toJSON()["Resources"] as Record<string, { Type: string }>).map((r) => r.Type);
    expect([...new Set(types)].toSorted()).toEqual(["AWS::IAM::OIDCProvider", "AWS::IAM::Role"]);
  });
});
