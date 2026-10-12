import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import type { StateMachine } from "../../src/workflow.ts";
import { LongJobsStack } from "../lib/long-jobs-stack.ts";

// Synthesized once each: every synth bundles the functions with esbuild.
const synth = (durable: boolean) =>
  Template.fromStack(
    new LongJobsStack(new App(), "AihLongJobs", { env: { region: "ap-northeast-1" }, durable }),
  );
const base = synth(false);
const withDurable = synth(true);

type Statement = {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
};
type Resource = { Type: string; Properties: Record<string, unknown>; DependsOn?: string[] };
const resourcesOf = (template: Template) =>
  template.toJSON()["Resources"] as Record<string, Resource>;
const typesOf = (template: Template): string[] =>
  [...new Set(Object.values(resourcesOf(template)).map((resource) => resource.Type))].toSorted();

/** The actions a role is allowed, found through the policy attached to it. */
function actionsOf(template: Template, rolePrefix: string): string[] {
  return statementsOf(template, rolePrefix)
    .flatMap((statement) => [statement.Action].flat())
    .toSorted();
}
function statementsOf(template: Template, rolePrefix: string): Statement[] {
  return Object.values(template.findResources("AWS::IAM::Policy"))
    .filter((policy) =>
      (policy["Properties"].Roles as { Ref: string }[]).some((role) =>
        role.Ref.startsWith(rolePrefix),
      ),
    )
    .flatMap((policy) => policy["Properties"].PolicyDocument.Statement as Statement[]);
}

/** The definition as Step Functions would receive it, with each function ARN replaced by its logical ID. */
function definitionOf(template: Template): StateMachine {
  const [machine] = Object.values(template.findResources("AWS::StepFunctions::StateMachine"));
  if (machine === undefined) {
    throw new Error("the template has no state machine");
  }
  const parts = (machine["Properties"].DefinitionString as { "Fn::Join": [string, unknown[]] })[
    "Fn::Join"
  ][1];
  const text = parts
    .map((part) =>
      typeof part === "string"
        ? part
        : (part as { "Fn::GetAtt": [string, string] })["Fn::GetAtt"][0],
    )
    .join("");
  return JSON.parse(text) as StateMachine;
}

// cdkd 0.296.28 registers a dedicated provider for each of these.
const BASE_TYPES = [
  "AWS::DynamoDB::Table",
  "AWS::IAM::Policy",
  "AWS::IAM::Role",
  "AWS::Lambda::Function",
  "AWS::Logs::LogGroup",
  "AWS::S3::Bucket",
  "AWS::S3::BucketPolicy",
  "AWS::Scheduler::Schedule",
  "AWS::StepFunctions::StateMachine",
];

describe("LongJobsStack, default", () => {
  it("uses only resource types cdkd has a provider for, and nothing billed by the hour", () => {
    expect(typesOf(base)).toEqual(BASE_TYPES);
    base.hasResourceProperties("AWS::DynamoDB::Table", { BillingMode: "PAY_PER_REQUEST" });
    expect(
      Object.keys(resourcesOf(base)).filter((id) =>
        resourcesOf(base)[id]?.Type.startsWith("Custom::"),
      ),
    ).toEqual([]);
  });

  it("has no durable function unless asked", () => {
    base.resourceCountIs("AWS::Lambda::Function", 3);
    base.resourceCountIs("AWS::Lambda::Version", 0);
    base.resourceCountIs("AWS::Lambda::Alias", 0);
    for (const fn of Object.values(base.findResources("AWS::Lambda::Function"))) {
      expect(fn["Properties"]).not.toHaveProperty("DurableConfig");
    }
  });

  it("keeps the exports private and deletes them after a week", () => {
    base.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] },
      LifecycleConfiguration: {
        Rules: [{ Prefix: "exports/", ExpirationInDays: 7, Status: "Enabled" }],
      },
    });
    // The only bucket policy statement is the one that refuses plain HTTP.
    const [policy] = Object.values(base.findResources("AWS::S3::BucketPolicy"));
    const statements = policy?.["Properties"].PolicyDocument.Statement as Statement[];
    expect(statements.map((statement) => statement.Effect)).toEqual(["Deny"]);
  });

  it("deletes the bucket, the table, the logs, and the state machine with the stack", () => {
    for (const type of [
      "AWS::S3::Bucket",
      "AWS::DynamoDB::Table",
      "AWS::Logs::LogGroup",
      "AWS::StepFunctions::StateMachine",
    ]) {
      for (const resource of Object.values(base.findResources(type))) {
        expect(resource["DeletionPolicy"]).toBe("Delete");
      }
    }
    base.allResourcesProperties("AWS::Logs::LogGroup", { RetentionInDays: 7 });
  });

  it("gives each step its own role with only what the step does", () => {
    const logs = ["logs:CreateLogStream", "logs:PutLogEvents"];
    expect(actionsOf(base, "ExportPagesRole")).toEqual([
      "dynamodb:Scan",
      ...logs,
      "s3:GetObject",
      "s3:PutObject",
    ]);
    expect(actionsOf(base, "FinishRole")).toEqual([...logs, "s3:ListBucket", "s3:PutObject"]);
    expect(actionsOf(base, "DiscardRole")).toEqual([...logs, "s3:DeleteObject", "s3:ListBucket"]);
    base.allResourcesProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("never grants a bare wildcard, and scopes object access to the exports prefix", () => {
    const statements = Object.values(base.findResources("AWS::IAM::Policy")).flatMap(
      (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
    );
    for (const statement of statements) {
      expect(JSON.stringify(statement.Resource)).not.toContain('"*"');
      if ([statement.Action].flat().some((action) => /^s3:(Get|Put|Delete)Object$/.test(action))) {
        expect(JSON.stringify(statement.Resource)).toContain("/exports/*");
      }
      if ([statement.Action].flat().includes("s3:ListBucket")) {
        expect(statement.Condition).toEqual({ StringLike: { "s3:prefix": "exports/*" } });
      }
    }
  });

  it("lets Step Functions invoke the three functions and nothing else", () => {
    expect(actionsOf(base, "WorkflowRole")).toEqual(["lambda:InvokeFunction"]);
    const [statement] = statementsOf(base, "WorkflowRole");
    expect(statement?.Resource).toEqual([
      { "Fn::GetAtt": [expect.stringMatching(/^ExportPages/), "Arn"] },
      { "Fn::GetAtt": [expect.stringMatching(/^Finish/), "Arn"] },
      { "Fn::GetAtt": [expect.stringMatching(/^Discard/), "Arn"] },
    ]);
    base.hasResourceProperties("AWS::IAM::Role", {
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

  it("deploys the definition the local run uses, as a standard workflow with the ARNs inline", () => {
    base.hasResourceProperties("AWS::StepFunctions::StateMachine", {
      StateMachineType: "STANDARD",
      // cdkd 0.296.28 substitutes these only into a definition it fetches from S3.
      DefinitionSubstitutions: Match.absent(),
    });
    const definition = definitionOf(base);
    expect(definition.StartAt).toBe("ExportPages");
    expect(Object.keys(definition.States)).toEqual([
      "ExportPages",
      "MorePages",
      "Finish",
      "Exported",
      "Discard",
      "Discarded",
    ]);
    expect(definition.States["ExportPages"]).toMatchObject({
      Resource: expect.stringMatching(/^ExportPages/),
    });
    expect(definition.States["Finish"]).toMatchObject({
      Resource: expect.stringMatching(/^Finish/),
    });
    expect(definition.States["Discard"]).toMatchObject({
      Resource: expect.stringMatching(/^Discard/),
    });
  });

  it("lets each function finish or time out before its task gives up", () => {
    const definition = definitionOf(base);
    const functions = resourcesOf(base);
    for (const state of Object.values(definition.States)) {
      if (state.Type === "Task") {
        const timeout = functions[state.Resource]?.Properties["Timeout"] as number;
        expect(state.TimeoutSeconds).toBeGreaterThan(timeout);
      }
    }
    base.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
      Timeout: 300,
      Environment: { Variables: { PAGE_SIZE: "100", RESERVE_SECONDS: "60" } },
    });
  });

  it("starts the workflow once a day with the due time as the export's name", () => {
    base.hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: "aih-long-jobs-export",
      ScheduleExpression: "rate(1 day)",
      FlexibleTimeWindow: { Mode: "OFF" },
      Target: {
        Arn: { "Fn::GetAtt": [Match.stringLikeRegexp("^ExportWorkflow"), "Arn"] },
        RoleArn: { "Fn::GetAtt": [Match.stringLikeRegexp("^ScheduleRole"), "Arn"] },
        Input: '{"exportId":"<aws.scheduler.scheduled-time>"}',
        RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 900 },
      },
    });
    expect(actionsOf(base, "ScheduleRole")).toEqual(["states:StartExecution"]);
    expect(statementsOf(base, "ScheduleRole")[0]?.Resource).toEqual({
      "Fn::GetAtt": [expect.stringMatching(/^ExportWorkflow/), "Arn"],
    });
  });
});

describe("LongJobsStack with -c durable=true", () => {
  it("adds one function, a version, and an alias", () => {
    // Neither has a dedicated provider in cdkd 0.296.28: both go through Cloud Control API.
    expect(typesOf(withDurable)).toEqual(
      [...BASE_TYPES, "AWS::Lambda::Alias", "AWS::Lambda::Version"].toSorted(),
    );
    withDurable.resourceCountIs("AWS::Lambda::Function", 4);
    withDurable.resourceCountIs("AWS::StepFunctions::StateMachine", 1);
  });

  it("turns durable execution on with a six-hour limit and one day of history", () => {
    withDurable.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "aih-long-jobs-durable-export",
      Runtime: "nodejs24.x",
      Timeout: 300,
      DurableConfig: { ExecutionTimeout: 21600, RetentionPeriodInDays: 1 },
    });
    withDurable.hasResourceProperties("AWS::Lambda::Alias", { Name: "live" });
  });

  it("lets the function checkpoint its own executions, and only its own", () => {
    expect(actionsOf(withDurable, "DurableExportRole")).toEqual([
      "dynamodb:Scan",
      "lambda:CheckpointDurableExecution",
      "lambda:GetDurableExecutionState",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:PutObject",
    ]);
    const checkpoint = statementsOf(withDurable, "DurableExportRole").find((statement) =>
      [statement.Action].flat().includes("lambda:CheckpointDurableExecution"),
    );
    expect(JSON.stringify(checkpoint?.Resource)).toContain(
      ":function:aih-long-jobs-durable-export:*",
    );
    withDurable.allResourcesProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });
});
