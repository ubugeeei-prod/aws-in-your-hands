import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import type { StateMachine } from "../../src/asl.ts";
import { noteDigestWorkflow } from "../../src/digest.ts";
import { runStateMachine } from "../../src/interpreter.ts";
import { leftover, violations } from "../../src/invariant.ts";
import { LocalWorld } from "../../src/local-world.ts";
import { executionName, importNoteWorkflow } from "../../src/saga.ts";
import { INPUT, path } from "../../test/harness.ts";
import { StepFunctionsStack } from "../lib/step-functions-stack.ts";

const template = Template.fromStack(
  new StepFunctionsStack(new App(), "AihStepFunctions", { env: { region: "ap-northeast-1" } }),
);

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
type Resource = { Type: string; Properties: Record<string, unknown>; DeletionPolicy?: string };
const resources = template.toJSON()["Resources"] as Record<string, Resource>;

function statementsOf(rolePrefix: string): Statement[] {
  return Object.values(template.findResources("AWS::IAM::Policy"))
    .filter((policy) =>
      (policy["Properties"].Roles as { Ref: string }[]).some((role) =>
        role.Ref.startsWith(rolePrefix),
      ),
    )
    .flatMap((policy) => policy["Properties"].PolicyDocument.Statement as Statement[]);
}
const actionsOf = (rolePrefix: string): string[] =>
  statementsOf(rolePrefix)
    .flatMap((statement) => [statement.Action].flat())
    .toSorted();

// #region deployed-definition
/**
 * The definition as the template carries it, with each reference to another
 * resource replaced by that resource's logical ID.
 */
function definitionOf(logicalIdPrefix: string): StateMachine {
  const machine = Object.entries(resources).find(
    ([id, resource]) =>
      id.startsWith(logicalIdPrefix) && resource.Type === "AWS::StepFunctions::StateMachine",
  )?.[1];
  if (machine === undefined) {
    throw new Error(`the template has no state machine ${logicalIdPrefix}`);
  }
  const parts = (machine.Properties["DefinitionString"] as { "Fn::Join": [string, unknown[]] })[
    "Fn::Join"
  ][1];
  const text = parts
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      const reference = part as { Ref?: string; "Fn::GetAtt"?: [string, string] };
      return reference.Ref ?? reference["Fn::GetAtt"]?.[0] ?? "?";
    })
    .join("");
  return JSON.parse(text) as StateMachine;
}
const logicalId = (prefix: string, type: string): string =>
  Object.entries(resources).find(
    ([id, resource]) => id.startsWith(prefix) && resource.Type === type,
  )?.[0] ?? "?";
const deployed = {
  tableName: logicalId("Notes", "AWS::DynamoDB::Table"),
  bucketName: logicalId("Files", "AWS::S3::Bucket"),
  queueUrl: logicalId("ScanRequests", "AWS::SQS::Queue"),
  topicArn: logicalId("Imports", "AWS::SNS::Topic"),
};
// #endregion deployed-definition

describe("StepFunctionsStack", () => {
  it("uses only resource types cdkd has a provider for, and nothing billed by the hour", () => {
    const types = [...new Set(Object.values(resources).map((resource) => resource.Type))];
    // cdkd 0.296.28 registers a dedicated provider for each of these.
    expect(types.toSorted()).toEqual([
      "AWS::DynamoDB::Table",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Logs::LogGroup",
      "AWS::S3::Bucket",
      "AWS::S3::BucketPolicy",
      "AWS::SNS::Topic",
      "AWS::SNS::TopicPolicy",
      "AWS::SQS::Queue",
      "AWS::SQS::QueuePolicy",
      "AWS::StepFunctions::StateMachine",
    ]);
    template.hasResourceProperties("AWS::DynamoDB::Table", { BillingMode: "PAY_PER_REQUEST" });
    template.resourceCountIs("AWS::StepFunctions::StateMachine", 2);
  });

  it("deletes everything it made with the stack", () => {
    for (const type of [
      "AWS::DynamoDB::Table",
      "AWS::S3::Bucket",
      "AWS::SQS::Queue",
      "AWS::SNS::Topic",
      "AWS::Logs::LogGroup",
      "AWS::StepFunctions::StateMachine",
    ]) {
      for (const resource of Object.values(template.findResources(type))) {
        expect(resource["DeletionPolicy"]).toBe("Delete");
      }
    }
  });

  it("keeps the bucket, the queue, and the topic closed to everyone else", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] },
      LifecycleConfiguration: {
        Rules: [{ Prefix: "inbox/", ExpirationInDays: 1, Status: "Enabled" }],
      },
    });
    // Each resource policy holds one statement: the refusal of plain HTTP.
    for (const type of [
      "AWS::S3::BucketPolicy",
      "AWS::SQS::QueuePolicy",
      "AWS::SNS::TopicPolicy",
    ]) {
      const [policy] = Object.values(template.findResources(type));
      const statements = policy?.["Properties"].PolicyDocument.Statement as Statement[];
      expect(statements.map((statement) => statement.Effect)).toEqual(["Deny"]);
    }
    template.hasResourceProperties("AWS::SQS::Queue", { MessageRetentionPeriod: 86_400 });
  });

  it("lets Step Functions assume the roles only for this account's state machines", () => {
    template.resourceCountIs("AWS::IAM::Role", 2);
    template.allResourcesProperties("AWS::IAM::Role", {
      ManagedPolicyArns: Match.absent(),
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: { Service: "states.amazonaws.com" },
            Condition: {
              StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" } },
              ArnLike: { "aws:SourceArn": Match.objectLike({ "Fn::Join": Match.anyValue() }) },
            },
          },
        ],
      },
    });
  });

  // #region least-privilege
  it("gives the import exactly the calls its states make", () => {
    expect(actionsOf("ImportRole")).toEqual([
      "dynamodb:DeleteItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:PutObject",
      "sns:Publish",
      "sqs:SendMessage",
    ]);
    for (const statement of statementsOf("ImportRole")) {
      const resource = JSON.stringify(statement.Resource);
      expect(resource).not.toContain('"*"');
      const actions = [statement.Action].flat();
      if (actions.includes("s3:GetObject")) {
        expect(resource).toContain("/inbox/*");
      }
      if (actions.includes("s3:PutObject") || actions.includes("s3:DeleteObject")) {
        expect(resource).toContain("/attachments/*");
      }
    }
    // Every integration the definition names is covered, and nothing reads the table.
    const called = Object.values(definitionOf("ImportNote").States).flatMap((state) =>
      state.Type === "Task" ? [state.Resource] : [],
    );
    expect([...new Set(called)].toSorted()).toEqual([
      "arn:aws:states:::aws-sdk:s3:copyObject",
      "arn:aws:states:::aws-sdk:s3:deleteObject",
      "arn:aws:states:::dynamodb:deleteItem",
      "arn:aws:states:::dynamodb:putItem",
      "arn:aws:states:::dynamodb:updateItem",
      "arn:aws:states:::sns:publish",
      "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
    ]);
  });

  it("lets the digest read the table, and gives it a wildcard only for log delivery", () => {
    const statements = statementsOf("DigestRole");
    expect(statements.map((statement) => [statement.Action].flat().toSorted())).toEqual([
      ["dynamodb:GetItem"],
      [
        "logs:CreateLogDelivery",
        "logs:CreateLogStream",
        "logs:DeleteLogDelivery",
        "logs:DescribeLogGroups",
        "logs:DescribeResourcePolicies",
        "logs:GetLogDelivery",
        "logs:ListLogDeliveries",
        "logs:PutLogEvents",
        "logs:PutResourcePolicy",
        "logs:UpdateLogDelivery",
      ],
    ]);
    expect(statements[0]?.Resource).toEqual({
      "Fn::GetAtt": [expect.stringMatching(/^Notes/), "Arn"],
    });
    expect(statements[1]?.Resource).toBe("*");
  });
  // #endregion least-privilege

  it("deploys the import as a Standard workflow and the digest as an Express one that logs failures", () => {
    template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
      StateMachineType: "STANDARD",
      LoggingConfiguration: Match.absent(),
      // cdkd 0.296.28 substitutes these only into a definition it fetches from S3.
      DefinitionSubstitutions: Match.absent(),
    });
    template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
      StateMachineType: "EXPRESS",
      LoggingConfiguration: {
        Level: "ERROR",
        IncludeExecutionData: false,
        Destinations: [
          {
            CloudWatchLogsLogGroup: {
              LogGroupArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^DigestLogs"), "Arn"] },
            },
          },
        ],
      },
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/vendedlogs/states/AihStepFunctions-NoteDigest",
      RetentionInDays: 7,
    });
  });

  // #region same-definition
  it("deploys the definitions the tests walk", () => {
    expect(definitionOf("ImportNote")).toEqual(importNoteWorkflow(deployed));
    expect(definitionOf("NoteDigest")).toEqual(
      noteDigestWorkflow({ tableName: deployed.tableName }),
    );
  });

  it("rolls back and succeeds when the template's own definition is walked", async () => {
    const definition = definitionOf("ImportNote");
    const run = (world: LocalWorld) =>
      runStateMachine(definition, INPUT, world, {
        name: executionName(INPUT),
        startTime: "2026-10-13T00:00:00.000Z",
      });

    const clean = new LocalWorld();
    clean.objects.set(INPUT.upload, "bytes");
    expect((await run(clean)).status).toBe("SUCCEEDED");
    expect(leftover(clean, INPUT)).toEqual({ note: "ready", attachment: true });

    const infected = new LocalWorld();
    infected.objects.set(INPUT.upload, "bytes");
    infected.scanner = () => ({ verdict: "infected" });
    const outcome = await run(infected);
    expect(path(outcome).slice(-3)).toEqual(["RemoveAttachment", "RemoveNote", "RolledBack"]);
    expect(violations(infected, INPUT, outcome)).toEqual([]);
  });
  // #endregion same-definition
});
