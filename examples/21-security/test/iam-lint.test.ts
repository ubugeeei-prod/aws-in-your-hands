import { readFileSync } from "node:fs";
import { CiStack } from "@aih/example-20-shipping/infra/lib/ci-stack.ts";
import { ciConfigSchema } from "@aih/example-20-shipping/infra/lib/config.ts";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { assertNoWildcards, exceptionSchema, lintTemplate } from "../src/iam-lint.ts";

type Statement = Record<string, unknown>;
const role = (statements: Statement[], extra: Record<string, unknown> = {}) => ({
  Resources: {
    Role: {
      Type: "AWS::IAM::Role",
      Properties: {
        AssumeRolePolicyDocument: {
          Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }],
        },
        Policies: [{ PolicyName: "p", PolicyDocument: { Version: "2012-10-17", Statement: statements } }],
        ...extra,
      },
    },
  },
});
const kinds = (template: unknown) => lintTemplate(template).findings.map((finding) => finding.kind);
const SCOPED = { "Fn::GetAtt": ["Table", "Arn"] };

describe("what the lint reports", () => {
  it("passes a named action on a named resource", () => {
    expect(kinds(role([{ Effect: "Allow", Action: "dynamodb:GetItem", Resource: SCOPED }]))).toEqual([]);
  });

  it.each([
    ["every action of a service", { Effect: "Allow", Action: "s3:*", Resource: SCOPED }, ["wildcard-action"]],
    ["a prefix of actions", { Effect: "Allow", Action: ["s3:Get*"], Resource: SCOPED }, ["wildcard-action"]],
    ["every resource", { Effect: "Allow", Action: "s3:GetObject", Resource: "*" }, ["wildcard-resource"]],
    [
      "every resource, in a list",
      { Effect: "Allow", Action: "s3:GetObject", Resource: [SCOPED, "*"] },
      ["wildcard-resource"],
    ],
    [
      "administrator in two characters",
      { Effect: "Allow", Action: "*", Resource: "*" },
      ["wildcard-action", "wildcard-resource"],
    ],
    ["everything except", { Effect: "Allow", NotAction: "iam:*", Resource: SCOPED }, ["not-action"]],
    ["everywhere except", { Effect: "Allow", Action: "s3:GetObject", NotResource: SCOPED }, ["not-resource"]],
  ])("flags %s", (_, statement, expected) => {
    expect(kinds(role([statement]))).toEqual(expected);
  });

  it("leaves Deny statements alone", () => {
    expect(kinds(role([{ Effect: "Deny", Action: "*", Resource: "*" }]))).toEqual([]);
  });

  it("flags broad AWS managed policies, in either way CDK writes the ARN", () => {
    const joined = { "Fn::Join": ["", ["arn:", { Ref: "AWS::Partition" }, ":iam::aws:policy/AdministratorAccess"]] };
    const template = role([], {
      ManagedPolicyArns: [
        joined,
        "arn:aws:iam::aws:policy/AmazonS3FullAccess",
        "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
      ],
    });
    expect(lintTemplate(template).findings).toEqual([
      { resource: "Role", kind: "broad-managed-policy", detail: "AdministratorAccess" },
      { resource: "Role", kind: "broad-managed-policy", detail: "AmazonS3FullAccess" },
    ]);
  });

  it("flags a role that anyone may assume, unless a condition narrows it", () => {
    const open = { Statement: [{ Effect: "Allow", Principal: { AWS: "*" }, Action: "sts:AssumeRole" }] };
    expect(kinds(role([], { AssumeRolePolicyDocument: open }))).toEqual(["open-trust"]);
    const narrowed = {
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: "*" },
          Action: "sts:AssumeRole",
          Condition: { StringEquals: { "aws:PrincipalOrgID": "o-example" } },
        },
      ],
    };
    expect(kinds(role([], { AssumeRolePolicyDocument: narrowed }))).toEqual([]);
  });

  it("reads standalone and managed policy resources too", () => {
    const document = { Statement: [{ Effect: "Allow", Action: "kms:*", Resource: "*" }] };
    const template = {
      Resources: {
        A: { Type: "AWS::IAM::Policy", Properties: { PolicyDocument: document } },
        B: { Type: "AWS::IAM::ManagedPolicy", Properties: { PolicyDocument: document } },
        C: { Type: "AWS::S3::Bucket", Properties: {} },
      },
    };
    expect(lintTemplate(template).findings.map((finding) => finding.resource)).toEqual(["A", "A", "B", "B"]);
  });

  it("reports a policy it cannot read instead of passing it", () => {
    expect(kinds(role([{ Effect: "Maybe", Action: "s3:GetObject", Resource: "*" }]))).toEqual(["unreadable"]);
    const template = { Resources: { A: { Type: "AWS::IAM::Policy", Properties: {} } } };
    expect(kinds(template)).toEqual(["unreadable"]);
  });
});

describe("exceptions", () => {
  const wide = role([{ Effect: "Allow", Action: ["logs:DescribeLogGroups", "logs:PutLogEvents"], Resource: "*" }]);
  const reason = "A list call: the service reference names no resource type for it.";

  it("covers exactly the action it names", () => {
    const { findings, unusedExceptions } = lintTemplate(wide, [{ action: "logs:DescribeLogGroups", reason }]);
    expect(findings).toEqual([
      { resource: "Role", kind: "wildcard-resource", detail: 'logs:PutLogEvents on Resource "*"' },
    ]);
    expect(unusedExceptions).toEqual([]);
  });

  it("never excuses a wildcard in the action itself", () => {
    const template = role([{ Effect: "Allow", Action: "logs:Describe*", Resource: "*" }]);
    expect(kinds(template)).toContain("wildcard-action");
    expect(exceptionSchema.safeParse({ action: "logs:Describe*", reason }).success).toBe(false);
  });

  it("needs a reason someone can argue with", () => {
    expect(exceptionSchema.safeParse({ action: "logs:DescribeLogGroups", reason: "needed" }).success).toBe(false);
    expect(() => lintTemplate(wide, [{ action: "logs:DescribeLogGroups", reason: "" }])).toThrow();
  });

  it("fails when an exception no longer matches anything", () => {
    const narrow = role([{ Effect: "Allow", Action: "logs:PutLogEvents", Resource: SCOPED }]);
    expect(() => assertNoWildcards(narrow, [{ action: "logs:DescribeLogGroups", reason }])).toThrow(
      "exception for logs:DescribeLogGroups matches nothing",
    );
  });
});

describe("chapter 20's CI roles", () => {
  const exceptions = z
    .record(z.string(), z.array(exceptionSchema))
    .parse(JSON.parse(readFileSync(new URL("../policies/iam-lint-exceptions.json", import.meta.url), "utf8")));
  const template = Template.fromStack(
    new CiStack(new App({ analyticsReporting: false }), "AihShipCi", {
      env: { region: "ap-northeast-1" },
      ci: ciConfigSchema.parse({ githubRepository: "octo-org/octo-repo" }),
    }),
  ).toJSON();

  it("pass with five exceptions, each with its reason on file", () => {
    expect(exceptions["AihShipCi"]).toHaveLength(5);
    expect(() => assertNoWildcards(template, exceptions["AihShipCi"])).not.toThrow();
  });

  it("fail without them, on exactly those five actions", () => {
    const findings = lintTemplate(template).findings;
    expect(findings.map((finding) => finding.kind)).toEqual(Array.from({ length: 5 }, () => "wildcard-resource"));
    expect(findings.map((finding) => finding.resource.replace(/[0-9A-F]{8}$/, ""))).toEqual(
      Array.from({ length: 5 }, () => "DriftRole"),
    );
  });
});
