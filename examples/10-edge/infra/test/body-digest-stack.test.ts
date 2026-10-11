import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { BodyDigestStack } from "../lib/body-digest-stack.ts";

const build = (region: string): Template =>
  Template.fromStack(new BodyDigestStack(new App(), "AihEdgeBodyDigest", { env: { region } }));

// Each synth bundles the handler with esbuild. Built once, with room for a busy machine:
// under check:all this runs next to every other synth and build.
let template: Template | undefined;
beforeAll(() => {
  template = build("us-east-1");
}, 60_000);
const synth = (): Template => {
  if (template === undefined) {
    throw new Error("the template was not built");
  }
  return template;
};

describe("BodyDigestStack", () => {
  it("can only be placed in us-east-1", () => {
    expect(() => build("ap-northeast-1")).toThrow(/us-east-1/);
  });

  it("stays within what Lambda@Edge accepts", () => {
    synth().hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs24.x",
      Architectures: ["x86_64"],
      MemorySize: 128,
      Timeout: 5,
      // Each of these is refused when the version is attached to a distribution.
      Environment: Match.absent(),
      VpcConfig: Match.absent(),
      Layers: Match.absent(),
      DeadLetterConfig: Match.absent(),
      TracingConfig: Match.absent(),
    });
  });

  it("lets both Lambda and the edge service assume the role", () => {
    const roles = synth().findResources("AWS::IAM::Role");
    const principals = Object.values(roles).flatMap((role) =>
      (role["Properties"].AssumeRolePolicyDocument.Statement as { Principal: { Service: string } }[]).map(
        (statement) => statement.Principal.Service,
      ),
    );
    expect(principals.toSorted()).toEqual(["edgelambda.amazonaws.com", "lambda.amazonaws.com"]);
    for (const role of Object.values(roles)) {
      expect(role["Properties"].ManagedPolicyArns).toBeUndefined();
    }
  });

  it("allows writing this function's logs, in any Region, and nothing else", () => {
    const policies = Object.values(synth().findResources("AWS::IAM::Policy"));
    const statements = policies.flatMap(
      (policy) => policy["Properties"].PolicyDocument.Statement as { Action: string[]; Resource: unknown[] }[],
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]?.Action).toEqual(["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]);

    const resources = JSON.stringify(statements[0]?.Resource);
    // One wildcard for the Region, one for the streams inside the group. The group itself is named.
    expect(resources.match(/\*/g)).toHaveLength(3);
    expect(resources).toContain("arn:aws:logs:*:");
    expect(resources).toContain(":log-group:/aws/lambda/us-east-1.aih-edge-body-digest");
    expect(resources).not.toContain('"*"');
  });

  it("publishes a numbered version for CloudFront to point at", () => {
    const template = synth();
    template.resourceCountIs("AWS::Lambda::Version", 1);
    const outputs = template.toJSON()["Outputs"] as Record<string, { Value: unknown }>;
    expect(JSON.stringify(outputs["BodyDigestVersionArn"]?.Value)).toMatch(/"Ref":"BodyDigestCurrentVersion/);
  });

  it("uses only resource types checked against cdkd", () => {
    const resources = synth().toJSON()["Resources"] as Record<string, { Type: string }>;
    expect([...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted()).toEqual([
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Lambda::Function",
      "AWS::Lambda::Version",
    ]);
  });
});
