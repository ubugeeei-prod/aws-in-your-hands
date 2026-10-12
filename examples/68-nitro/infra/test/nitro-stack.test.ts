import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { parseNitroConfig } from "../../src/config.ts";
import { ADMIN_ACTIONS, ATTESTED_ACTIONS, evaluate, IMAGE_SHA384 } from "../../src/policy.ts";
import { NitroStack } from "../lib/nitro-stack.ts";

type Resource = { Type: string; Properties?: Record<string, unknown>; DeletionPolicy?: string };
type Statement = {
  Sid?: string;
  Effect: string;
  Principal: { AWS: unknown };
  Action: string[];
  Condition?: unknown;
};

const PCR0 =
  "7fb5c55bc2ecbb68ed99a13d7122abfc0666b926a79d5379bc58b9445c84217f59cfdd36c08b2c79552928702efe23e4";

const synth = (settings: Record<string, unknown> = {}) => {
  const app = new App();
  const stack = new NitroStack(app, "AihNitro", {
    env: { region: "ap-northeast-1" },
    config: parseNitroConfig(settings),
  });
  const json = Template.fromStack(stack).toJSON() as { Resources: Record<string, Resource> };
  const entries = Object.entries(json.Resources);
  const only = (type: string): [string, Resource] => {
    const [first, ...rest] = entries.filter(([, resource]) => resource.Type === type);
    if (first === undefined || rest.length > 0) {
      throw new Error(`expected exactly one ${type}`);
    }
    return first;
  };
  const properties = (type: string) => only(type)[1].Properties ?? {};
  const keyPolicy = properties("AWS::KMS::Key")["KeyPolicy"] as { Statement: Statement[] };
  // The role as the key policy names it: a reference to the role in this template.
  const role = JSON.stringify({ "Fn::GetAtt": [only("AWS::IAM::Role")[0], "Arn"] });
  const types = [...new Set(entries.map(([, resource]) => resource.Type))].toSorted();
  return { app, json, only, properties, keyPolicy, role, types };
};

const unnamed = synth();
const named = synth({ measurement: PCR0 });

// cdkd 0.296.28 registers a dedicated provider for each of these.
const DEDICATED = [
  "AWS::EC2::Instance",
  "AWS::EC2::SecurityGroup",
  "AWS::IAM::InstanceProfile",
  "AWS::IAM::Role",
  "AWS::KMS::Key",
];

describe("NitroStack", () => {
  it("uses only resource types checked against cdkd", () => {
    expect(unnamed.types).toEqual(DEDICATED);
    expect(named.types).toEqual(DEDICATED);
  });

  it("launches an enclave-enabled Graviton instance that is not burstable", () => {
    const instance = unnamed.properties("AWS::EC2::Instance");
    expect(instance["EnclaveOptions"]).toEqual({ Enabled: true });
    expect(instance["InstanceType"]).toBe("c6g.large");
    // Hibernation cannot be combined with enclaves, and a T type cannot be a parent.
    expect(instance["HibernationOptions"]).toBeUndefined();
    expect(String(instance["InstanceType"]).startsWith("t")).toBe(false);
  });

  it("accepts no inbound connection and lets only HTTPS out", () => {
    const group = unnamed.properties("AWS::EC2::SecurityGroup");
    expect(group["SecurityGroupIngress"]).toBeUndefined();
    expect(group["SecurityGroupEgress"]).toEqual([
      {
        IpProtocol: "tcp",
        FromPort: 443,
        ToPort: 443,
        CidrIp: "0.0.0.0/0",
        Description: "HTTPS to AWS APIs and image registries",
      },
    ]);
    expect(unnamed.json.Resources).not.toHaveProperty("AWS::EC2::SecurityGroupIngress");
  });

  it("requires IMDSv2 and keeps the role's credentials one hop from the instance", () => {
    expect(unnamed.properties("AWS::EC2::Instance")["MetadataOptions"]).toEqual({
      HttpEndpoint: "enabled",
      HttpTokens: "required",
      HttpPutResponseHopLimit: 1,
    });
  });

  it("gives the role no KMS permission of its own", () => {
    const role = named.properties("AWS::IAM::Role");
    expect(role["Policies"]).toBeUndefined();
    expect(named.json.Resources).not.toHaveProperty("AWS::IAM::Policy");
    expect(JSON.stringify(role["ManagedPolicyArns"])).toContain("AmazonSSMManagedInstanceCore");
    expect(JSON.stringify(named.json)).not.toContain("kms:*");
  });

  it("writes a key policy nobody can use the key with until an image is named", () => {
    expect(unnamed.keyPolicy.Statement.map((statement) => statement.Sid)).toEqual([
      "AdministerWithoutUsing",
    ]);
    for (const action of ATTESTED_ACTIONS) {
      expect(
        evaluate(unnamed.keyPolicy, {
          principal: unnamed.role,
          action,
          attestedPcrs: { 0: PCR0 },
        }).allowed,
      ).toBe(false);
    }
  });

  it("gives the account the administration of the key, never its use", () => {
    const [admin] = named.keyPolicy.Statement;
    expect(admin?.Action).toEqual([...ADMIN_ACTIONS]);
    expect(JSON.stringify(admin?.Principal)).toContain(":root");
    expect(admin?.Condition).toBeUndefined();
  });

  it("releases a data key only to the role, and only with the named measurement", () => {
    const use = named.keyPolicy.Statement.filter((statement) =>
      statement.Action.some((action) => (ATTESTED_ACTIONS as readonly string[]).includes(action)),
    );
    expect(use).toHaveLength(1);
    expect(use[0]).toMatchObject({
      Effect: "Allow",
      Action: [...ATTESTED_ACTIONS],
      Condition: { StringEqualsIgnoreCase: { [IMAGE_SHA384]: PCR0 } },
    });
  });

  it("refuses the parent and admits the enclave, read by this book's evaluator", () => {
    const ask = (attestedPcrs?: Record<number, string>) =>
      evaluate(named.keyPolicy, {
        principal: named.role,
        action: "kms:Decrypt",
        ...(attestedPcrs === undefined ? {} : { attestedPcrs }),
      }).allowed;
    expect(ask()).toBe(false);
    expect(ask({ 0: "0".repeat(96) })).toBe(false);
    expect(ask({ 0: "ab".repeat(48) })).toBe(false);
    expect(ask({ 0: PCR0 })).toBe(true);
  });

  it("deletes the practice key with the stack, after the shortest wait", () => {
    const [, key] = unnamed.only("AWS::KMS::Key");
    expect(key.DeletionPolicy).toBe("Delete");
    expect(key.Properties?.["PendingWindowInDays"]).toBe(7);
  });

  it("offers the larger type and a pinned AMI through context", () => {
    const other = synth({ instanceType: "m6g.large", amiId: "ami-0123456789abcdef0" });
    expect(other.properties("AWS::EC2::Instance")).toMatchObject({
      InstanceType: "m6g.large",
      ImageId: "ami-0123456789abcdef0",
    });
  });

  it("synthesizes without asking AWS anything", () => {
    expect(unnamed.app.synth().manifest.missing).toBeUndefined();
    expect(JSON.stringify(unnamed.json)).not.toContain("Fn::GetAZs");
  });
});
