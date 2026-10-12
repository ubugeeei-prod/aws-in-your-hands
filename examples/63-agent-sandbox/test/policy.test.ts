import { describe, expect, it } from "vite-plus/test";

import { readTemplate } from "@aih/example-33-production-readiness/src/template.ts";

import { can, render, rolePolicy, type Statement, trustedPrincipals } from "../src/policy.ts";

const scope = { partition: "aws", region: "ap-northeast-1", account: "111111111111" };
const allow = (actions: string[], resources: string[], conditional = false): Statement => ({
  effect: "Allow",
  actions,
  resources,
  conditional,
});

describe("the evaluator's question: could these statements allow it?", () => {
  const table = "arn:aws:dynamodb:ap-northeast-1:111111111111:table/notes";

  it("says no when no statement reaches the action or the resource", () => {
    const statements = [allow(["dynamodb:GetItem"], [table])];
    expect(can(statements, "dynamodb:GetItem", table)).toBe(true);
    expect(can(statements, "dynamodb:PutItem", table)).toBe(false);
    expect(can(statements, "dynamodb:GetItem", `${table}-prod`)).toBe(false);
    expect(can([], "sts:AssumeRole", "arn:aws:iam::999999999999:role/deploy")).toBe(false);
  });

  it("follows wildcards in actions and resources, and ignores case in the action only", () => {
    const statements = [allow(["s3:Get*"], ["arn:aws:s3:::notes-*/*"])];
    expect(can(statements, "s3:getobject", "arn:aws:s3:::notes-prod/a.txt")).toBe(true);
    expect(can(statements, "s3:PutObject", "arn:aws:s3:::notes-prod/a.txt")).toBe(false);
    expect(can(statements, "s3:GetObject", "arn:aws:s3:::Notes-prod/a.txt")).toBe(false);
    expect(can([allow(["*"], ["*"])], "iam:PassRole", "anything")).toBe(true);
  });

  it("lets an unconditional Deny win, and does not count on a conditional one", () => {
    const deny = (conditional: boolean): Statement => ({
      effect: "Deny",
      actions: ["s3:*"],
      resources: ["*"],
      conditional,
    });
    const allowed = allow(["s3:GetObject"], ["*"]);
    expect(can([allowed, deny(false)], "s3:GetObject", "arn:aws:s3:::b/k")).toBe(false);
    expect(can([allowed, deny(true)], "s3:GetObject", "arn:aws:s3:::b/k")).toBe(true);
  });

  it("counts an Allow with a condition as allowed: it errs towards reach", () => {
    expect(can([allow(["s3:GetObject"], ["*"], true)], "s3:GetObject", "arn:aws:s3:::b/k")).toBe(
      true,
    );
  });
});

describe("reading a role out of a template", () => {
  const template = readTemplate({
    Resources: {
      Role: {
        Type: "AWS::IAM::Role",
        Properties: {
          AssumeRolePolicyDocument: {
            Statement: [{ Effect: "Allow", Principal: { Service: "ecs-tasks.amazonaws.com" } }],
          },
          Policies: [
            {
              PolicyDocument: {
                Statement: [
                  {
                    Effect: "Allow",
                    Action: "logs:PutLogEvents",
                    Resource: { "Fn::GetAtt": ["Logs", "Arn"] },
                  },
                ],
              },
            },
          ],
        },
      },
      Attached: {
        Type: "AWS::IAM::Policy",
        Properties: {
          Roles: [{ Ref: "Role" }],
          PolicyDocument: {
            Statement: [
              {
                Effect: "Allow",
                Action: ["bedrock:InvokeModel"],
                Resource: {
                  "Fn::Join": [
                    "",
                    [
                      "arn:",
                      { Ref: "AWS::Partition" },
                      ":bedrock:",
                      { Ref: "AWS::Region" },
                      ":",
                      { Ref: "AWS::AccountId" },
                      ":inference-profile/p",
                    ],
                  ],
                },
              },
            ],
          },
        },
      },
      Elsewhere: {
        Type: "AWS::IAM::Policy",
        Properties: {
          Roles: [{ Ref: "OtherRole" }],
          PolicyDocument: { Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }] },
        },
      },
      Managed: {
        Type: "AWS::IAM::Role",
        Properties: { ManagedPolicyArns: ["arn:aws:iam::aws:policy/AdministratorAccess"] },
      },
      Odd: {
        Type: "AWS::IAM::Role",
        Properties: {
          Policies: [
            {
              PolicyDocument: {
                Statement: [
                  { Effect: "Allow", NotAction: "iam:*", Resource: "*" },
                  {
                    Effect: "Allow",
                    Action: "s3:GetObject",
                    Resource: { "Fn::Sub": "arn:aws:s3:::${Bucket}/*" },
                  },
                ],
              },
            },
          ],
        },
      },
    },
  });

  it("collects inline and attached statements, and only this role's", () => {
    const { statements, unread } = rolePolicy(template, "Role", scope);
    expect(unread).toEqual([]);
    expect(statements).toEqual([
      {
        effect: "Allow",
        actions: ["logs:PutLogEvents"],
        resources: ["<Logs.Arn>"],
        conditional: false,
      },
      {
        effect: "Allow",
        actions: ["bedrock:InvokeModel"],
        resources: ["arn:aws:bedrock:ap-northeast-1:111111111111:inference-profile/p"],
        conditional: false,
      },
    ]);
  });

  it("says what it could not read instead of calling the role safe", () => {
    expect(rolePolicy(template, "Managed", scope).unread).toEqual(["ManagedPolicyArns"]);
    const odd = rolePolicy(template, "Odd", scope);
    expect(odd.statements).toEqual([]);
    expect(odd.unread).toHaveLength(2);
    expect(odd.unread[0]).toBe("NotAction or NotResource");
    expect(odd.unread[1]).toMatch(/cannot render/);
    expect(() => rolePolicy(template, "Missing", scope)).toThrow(/no role/);
  });

  it("renders a placeholder for a resource of the stack, which matches no real ARN", () => {
    expect(render({ Ref: "Table" }, scope)).toBe("<Table>");
    expect(
      can(
        [
          {
            effect: "Allow",
            actions: ["dynamodb:*"],
            resources: ["<Table.Arn>"],
            conditional: false,
          },
        ],
        "dynamodb:GetItem",
        "arn:aws:dynamodb:ap-northeast-1:999999999999:table/notes",
      ),
    ).toBe(false);
  });

  it("lists who may assume the role", () => {
    expect(trustedPrincipals(template, "Role")).toEqual(["ecs-tasks.amazonaws.com"]);
  });
});
