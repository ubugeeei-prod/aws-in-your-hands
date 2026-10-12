import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import {
  decide,
  FULL_AWS_ACCESS,
  type Policy,
  policySchema,
  type Request,
} from "../src/policy-model.ts";

const raw = readFileSync(new URL("../policies/scp-guardrails.json", import.meta.url), "utf8");
const guardrails = policySchema.parse(JSON.parse(raw));

const ADMIN: Policy = FULL_AWS_ACCESS;
const developer = "arn:aws:iam::111111111111:role/Developer";
const request = (action: string, region = "ap-northeast-1", principalArn = developer): Request => ({
  action,
  region,
  principalArn,
});
/** A member account under the root: FullAWSAccess plus the guardrails at the root, FullAWSAccess at the account. */
const ATTACHED = [[FULL_AWS_ACCESS, guardrails], [FULL_AWS_ACCESS]];

describe("the guardrail file", () => {
  it("is something Organizations accepts as an SCP", () => {
    // SCPs have no Principal element; policySchema is strict, so one would have failed the parse above.
    expect(guardrails.Statement.length).toBeGreaterThan(0);
    // Whitespace outside strings does not have to be sent. The limit is 10,240 characters.
    expect(JSON.stringify(JSON.parse(raw)).length).toBeLessThan(10_240);
  });

  it("only denies", () => {
    expect(guardrails.Statement.map((statement) => statement.Effect)).toEqual(
      guardrails.Statement.map(() => "Deny"),
    );
  });

  it("names every statement, so a denial in CloudTrail can be traced to a line here", () => {
    const sids = guardrails.Statement.map((statement) => statement.Sid);
    expect(sids.every((sid) => sid !== undefined && /^[A-Za-z0-9]+$/.test(sid))).toBe(true);
    expect(new Set(sids).size).toBe(sids.length);
  });
});

describe("an SCP grants nothing", () => {
  it("leaves a principal with no identity policy with no permissions", () => {
    expect(decide(request("s3:GetObject"), [], ATTACHED)).toBe("implicit-deny");
  });

  it("allows what the identity policy allows and the guardrails do not deny", () => {
    expect(decide(request("s3:GetObject"), [ADMIN], ATTACHED)).toBe("allow");
    expect(decide(request("lambda:CreateFunction", "us-east-1"), [ADMIN], ATTACHED)).toBe("allow");
  });

  it("blocks everything once FullAWSAccess is detached and only Deny statements remain", () => {
    expect(decide(request("s3:GetObject"), [ADMIN], [[guardrails], [FULL_AWS_ACCESS]])).toBe(
      "implicit-deny",
    );
    // Missing at any one level is enough.
    expect(decide(request("s3:GetObject"), [ADMIN], [[FULL_AWS_ACCESS, guardrails], []])).toBe(
      "implicit-deny",
    );
  });
});

describe("what the guardrails stop, even for an administrator", () => {
  it.each([
    "organizations:LeaveOrganization",
    "cloudtrail:StopLogging",
    "cloudtrail:DeleteTrail",
    "guardduty:DeleteDetector",
    "config:StopConfigurationRecorder",
  ])("%s", (action) => {
    expect(decide(request(action), [ADMIN], ATTACHED)).toBe("explicit-deny");
  });

  it("anything in a Region the book does not use", () => {
    expect(decide(request("ec2:RunInstances", "eu-west-1"), [ADMIN], ATTACHED)).toBe(
      "explicit-deny",
    );
    expect(decide(request("ec2:RunInstances", "ap-northeast-1"), [ADMIN], ATTACHED)).toBe("allow");
  });

  it("but not the services exempted by NotAction, whichever Region their requests are counted in", () => {
    expect(decide(request("iam:CreateRole", "eu-west-1"), [ADMIN], ATTACHED)).toBe("allow");
    expect(decide(request("cloudfront:CreateDistribution", "eu-west-1"), [ADMIN], ATTACHED)).toBe(
      "allow",
    );
  });

  it("the root user of a member account", () => {
    const root = "arn:aws:iam::111111111111:root";
    expect(decide(request("s3:GetObject", "ap-northeast-1", root), [ADMIN], ATTACHED)).toBe(
      "explicit-deny",
    );
  });

  it("reading the audit trail stays allowed", () => {
    expect(decide(request("cloudtrail:LookupEvents"), [ADMIN], ATTACHED)).toBe("allow");
  });
});

describe("the model", () => {
  it("refuses a condition it does not implement instead of treating it as true", () => {
    const unknown = policySchema.parse({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Deny",
          Action: "*",
          Resource: "*",
          Condition: { Bool: { "aws:MultiFactorAuthPresent": "false" } },
        },
      ],
    });
    expect(() => decide(request("s3:GetObject"), [ADMIN], [[FULL_AWS_ACCESS, unknown]])).toThrow(
      "does not know",
    );
  });

  it("refuses a statement with a Principal", () => {
    const withPrincipal = { Effect: "Deny", Action: "*", Resource: "*", Principal: "*" };
    expect(
      policySchema.safeParse({ Version: "2012-10-17", Statement: [withPrincipal] }).success,
    ).toBe(false);
  });
});
