import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { LiveStack } from "../lib/live-stack.ts";

const synth = (streamKey: boolean) =>
  Template.fromStack(
    new LiveStack(new App(), "AihLive", { env: { region: "ap-northeast-1" }, streamKey }),
  );

const template = synth(true);
const json = JSON.stringify(template.toJSON());

describe("LiveStack: the stream key", () => {
  it("never reads the key's value into the template", () => {
    // Fn::GetAtt [StreamKey, Value] anywhere would put the secret in outputs, env vars or state.
    expect(json).not.toMatch(/"Fn::GetAtt":\["StreamKey","Value"\]/);
    expect(json).not.toContain('"Value"]');
  });

  it("outputs the key's ARN and nothing else about it", () => {
    const outputs = template.toJSON()["Outputs"] as Record<string, { Value: unknown }>;
    expect(Object.keys(outputs).toSorted()).toEqual([
      "ChannelArn",
      "EventLogGroupName",
      "IngestEndpoint",
      "PlaybackUrl",
      "StreamKeyArn",
    ]);
    expect(outputs["StreamKeyArn"]?.Value).toEqual({ "Fn::GetAtt": ["StreamKey", "Arn"] });
  });

  it("has exactly one key, tied to this channel", () => {
    template.resourceCountIs("AWS::IVS::StreamKey", 1);
    template.hasResourceProperties("AWS::IVS::StreamKey", {
      ChannelArn: { "Fn::GetAtt": ["Channel", "Arn"] },
    });
  });

  it("has no key at all when deployed with streamKey=off", () => {
    const locked = synth(false);
    locked.resourceCountIs("AWS::IVS::StreamKey", 0);
    locked.resourceCountIs("AWS::IVS::Channel", 1);
    expect(Object.keys(locked.toJSON()["Outputs"] as object)).not.toContain("StreamKeyArn");
  });

  it("gives the function no IVS permission, so it cannot read the key", () => {
    expect(json).not.toContain("ivs:");
  });
});

describe("LiveStack: the channel", () => {
  it("is the cheapest type, low latency, RTMPS only", () => {
    template.hasResourceProperties("AWS::IVS::Channel", {
      Type: "BASIC",
      LatencyMode: "LOW",
      InsecureIngest: false,
      Authorized: false,
    });
  });

  it("does not record to S3", () => {
    const channel = Object.values(template.findResources("AWS::IVS::Channel"))[0]?.[
      "Properties"
    ] as object;
    expect(Object.keys(channel)).not.toContain("RecordingConfigurationArn");
    template.resourceCountIs("AWS::IVS::RecordingConfiguration", 0);
    template.resourceCountIs("AWS::S3::Bucket", 0);
  });

  it("is deleted with the stack, and so are the key and the logs", () => {
    for (const type of ["AWS::IVS::Channel", "AWS::IVS::StreamKey", "AWS::Logs::LogGroup"]) {
      for (const resource of Object.values(template.findResources(type))) {
        expect(resource["DeletionPolicy"], type).toBe("Delete");
      }
    }
  });
});

describe("LiveStack: events", () => {
  it("matches IVS events for this channel only", () => {
    template.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: {
        source: ["aws.ivs"],
        "detail-type": ["IVS Stream State Change", "IVS Stream Health Change", "IVS Limit Breach"],
        resources: [{ "Fn::GetAtt": ["Channel", "Arn"] }],
      },
    });
  });

  it("lets only that rule invoke the function", () => {
    template.resourceCountIs("AWS::Lambda::Permission", 1);
    template.hasResourceProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunction",
      Principal: "events.amazonaws.com",
      SourceArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^ChannelEvents"), "Arn"] },
    });
  });

  it("lets the function write to its own log group and nothing else", () => {
    const policies = Object.values(template.findResources("AWS::IAM::Policy"));
    expect(policies).toHaveLength(1);
    const properties = policies[0]?.["Properties"] as
      | { PolicyDocument: { Statement: { Action: string[]; Resource: unknown }[] } }
      | undefined;
    const statements = properties?.PolicyDocument.Statement ?? [];
    expect(statements).toHaveLength(1);
    expect(statements[0]?.Action.toSorted()).toEqual(["logs:CreateLogStream", "logs:PutLogEvents"]);
    expect(JSON.stringify(statements[0]?.Resource)).toMatch(
      /^\{"Fn::GetAtt":\["EventLogs[0-9A-F]+","Arn"\]\}$/,
    );
    expect(json).not.toContain("AWSLambdaBasicExecutionRole");
  });

  it("keeps event logs for a week", () => {
    template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 7 });
  });
});

describe("LiveStack: resources", () => {
  it("uses only resource types looked up in the pinned cdkd", () => {
    const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect(
      [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
    ).toEqual([
      "AWS::Events::Rule",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      // No dedicated cdkd provider (Cloud Control API): IVS::Channel, IVS::StreamKey.
      "AWS::IVS::Channel",
      "AWS::IVS::StreamKey",
      "AWS::Lambda::Function",
      "AWS::Lambda::Permission",
      "AWS::Logs::LogGroup",
    ]);
  });
});
