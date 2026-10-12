import { readFileSync } from "node:fs";

import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { COLUMNS } from "@aih/example-26-analytics/src/record.ts";

import { JOB } from "../../src/job.ts";
import { RETENTION_DAYS } from "../../src/layout.ts";
import { GlueStack, LOG_GROUP_PREFIX } from "../lib/glue-stack.ts";

const synth = (schedule = false) =>
  Template.fromStack(
    new GlueStack(new App(), "AihGlue", { env: { region: "ap-northeast-1" }, schedule }),
  );
const stack = synth();

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
const only = (template: Template, type: string): Record<string, unknown> => {
  const found = Object.values(template.findResources(type));
  if (found.length !== 1) {
    throw new Error(`expected one ${type}, found ${String(found.length)}`);
  }
  return found[0]?.["Properties"] as Record<string, unknown>;
};
const statements = (only(stack, "AWS::IAM::Policy")["PolicyDocument"] as { Statement: Statement[] })
  .Statement;
const actionsOf = (statement: Statement) => [statement.Action].flat();

describe("the bucket", () => {
  it("is private, encrypted, and refuses plain HTTP", () => {
    stack.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
        ],
      },
    });
    const policy = only(stack, "AWS::S3::BucketPolicy") as {
      PolicyDocument: { Statement: (Statement & { Condition?: unknown })[] };
    };
    // One statement, and it is a refusal: nobody is given access through the bucket policy.
    expect(policy.PolicyDocument.Statement).toHaveLength(1);
    expect(policy.PolicyDocument.Statement[0]).toMatchObject({
      Effect: "Deny",
      Condition: { Bool: { "aws:SecureTransport": "false" } },
    });
  });

  it("keeps the curated files longer than the raw ones they were made from", () => {
    const rules = (
      only(stack, "AWS::S3::Bucket")["LifecycleConfiguration"] as {
        Rules: Record<string, unknown>[];
      }
    ).Rules;
    expect(rules.map((rule) => [rule["Prefix"] ?? null, rule["ExpirationInDays"] ?? null])).toEqual(
      [
        ["requests_json/", RETENTION_DAYS.raw],
        ["requests_curated/", RETENTION_DAYS.curated],
        [null, null],
      ],
    );
    expect(RETENTION_DAYS.curated).toBeGreaterThan(RETENTION_DAYS.raw);
    expect(rules.at(-1)).toMatchObject({
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
    });
  });
});

describe("the two tables", () => {
  const tables = Object.values(stack.findResources("AWS::Glue::Table")).map(
    (table) =>
      table["Properties"].TableInput as {
        Name: string;
        TableType: string;
        PartitionKeys: unknown;
        Parameters: Record<string, unknown>;
        StorageDescriptor: {
          Columns: unknown;
          Location: unknown;
          SerdeInfo: { SerializationLibrary: string };
        };
      },
  );

  it("list the same columns, the ones chapter 26's record has", () => {
    expect(tables.map((table) => table.Name).toSorted()).toEqual([
      "requests_curated",
      "requests_raw",
    ]);
    for (const table of tables) {
      expect(table.StorageDescriptor.Columns).toEqual(
        COLUMNS.map(({ name, type }) => ({ Name: name, Type: type })),
      );
      expect(table.PartitionKeys).toEqual([{ Name: "dt", Type: "string" }]);
      expect(table.TableType).toBe("EXTERNAL_TABLE");
    }
  });

  it("point at different folders, each read as what is in it", () => {
    const byName = Object.fromEntries(tables.map((table) => [table.Name, table]));
    expect(JSON.stringify(byName["requests_raw"]?.StorageDescriptor.Location)).toContain(
      "/requests_json/",
    );
    expect(byName["requests_raw"]?.StorageDescriptor.SerdeInfo.SerializationLibrary).toBe(
      "org.apache.hive.hcatalog.data.JsonSerDe",
    );
    expect(JSON.stringify(byName["requests_curated"]?.StorageDescriptor.Location)).toContain(
      "/requests_curated/",
    );
    expect(byName["requests_curated"]?.StorageDescriptor.SerdeInfo.SerializationLibrary).toBe(
      "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
    );
  });

  it("work out their partitions from the query, so no crawler and no stored partition exists", () => {
    for (const table of tables) {
      expect(table.Parameters).toMatchObject({
        "projection.enabled": "true",
        "projection.dt.type": "date",
        "projection.dt.format": "yyyy-MM-dd",
      });
    }
    stack.resourceCountIs("AWS::Glue::Crawler", 0);
    stack.resourceCountIs("AWS::Glue::Partition", 0);
  });
});

describe("the job", () => {
  const job = only(stack, "AWS::Glue::Job") as {
    DefaultArguments: Record<string, unknown>;
    Command: { Name: string; ScriptLocation: unknown };
  };

  it("is the smallest Spark job, with a timeout of its own", () => {
    stack.hasResourceProperties("AWS::Glue::Job", {
      Command: { Name: "glueetl" },
      GlueVersion: "5.1",
      WorkerType: "G.1X",
      NumberOfWorkers: 2,
      Timeout: JOB.timeoutMinutes,
      MaxRetries: 0,
      ExecutionProperty: { MaxConcurrentRuns: 1 },
    });
    // Far below the 480 minutes a job without a timeout is given.
    expect(JOB.timeoutMinutes).toBeLessThanOrEqual(10);
  });

  it("does not use a job bookmark", () => {
    expect(job.DefaultArguments["--job-bookmark-option"]).toBe("job-bookmark-disable");
  });

  it("is given every argument the script asks for, and reads and writes different folders", () => {
    const script = readFileSync(new URL("../../glue/curate.py", import.meta.url), "utf8");
    const asked = /getResolvedOptions\(sys\.argv, \[([^\]]*)\]\)/.exec(script)?.[1];
    const names = [...(asked ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    // JOB_NAME is passed by AWS Glue itself.
    expect(names).toEqual(["JOB_NAME", "source", "target", "days"]);
    for (const name of names.slice(1)) {
      expect(job.DefaultArguments).toHaveProperty([`--${String(name)}`]);
    }
    expect(JSON.stringify(job.DefaultArguments["--source"])).toContain("/requests_json/");
    expect(JSON.stringify(job.DefaultArguments["--target"])).toContain("/requests_curated/");
    expect(job.DefaultArguments["--days"]).toBe("auto");
  });

  it("writes its logs to two groups that expire and go with the stack", () => {
    expect(job.DefaultArguments["--custom-logGroup-prefix"]).toBe(LOG_GROUP_PREFIX);
    const names = Object.values(stack.findResources("AWS::Logs::LogGroup")).map(
      (group) => group["Properties"].LogGroupName as string,
    );
    expect(names.toSorted()).toEqual([`${LOG_GROUP_PREFIX}/error`, `${LOG_GROUP_PREFIX}/output`]);
    stack.allResourcesProperties("AWS::Logs::LogGroup", { RetentionInDays: 7 });
    stack.allResources("AWS::Logs::LogGroup", { DeletionPolicy: "Delete" });
  });
});

describe("the job's role", () => {
  it("is trusted by AWS Glue only, and has no managed policy", () => {
    const role = only(stack, "AWS::IAM::Role") as {
      AssumeRolePolicyDocument: { Statement: { Principal: unknown }[] };
      ManagedPolicyArns?: unknown;
    };
    expect(role.AssumeRolePolicyDocument.Statement.map((each) => each.Principal)).toEqual([
      { Service: "glue.amazonaws.com" },
    ]);
    expect(role.ManagedPolicyArns).toBeUndefined();
  });

  it("names every action and every resource", () => {
    for (const statement of statements) {
      expect(statement.Effect).toBe("Allow");
      for (const action of actionsOf(statement)) {
        expect(action).not.toContain("*");
      }
      expect(statement.Resource).not.toBe("*");
    }
    expect(statements.flatMap(actionsOf).toSorted()).toEqual([
      "logs:CreateLogStream",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:PutLogEvents",
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetBucketLocation",
      "s3:GetObject",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:PutObject",
    ]);
  });

  it("can change objects under the curated prefix and nowhere else", () => {
    const writing = statements.filter((statement) =>
      actionsOf(statement).some((action) => /^s3:(Put|Delete|Abort)/.test(action)),
    );
    expect(writing).toHaveLength(1);
    const resource = JSON.stringify(writing[0]?.Resource);
    expect(resource).toContain("/requests_curated/*");
    expect(resource).not.toContain("requests_json");
  });

  it("reads the raw prefix and its one script, not the bucket the script shares", () => {
    const reading = statements.find(
      (statement) => JSON.stringify(statement.Action) === '"s3:GetObject"',
    );
    const resources = [reading?.Resource].flat().map((each) => JSON.stringify(each));
    expect(resources).toHaveLength(2);
    expect(resources[0]).toContain("/requests_json/*");
    expect(resources[1]).toMatch(/assets-.*\/[0-9a-f]{64}\.py/);
    expect(resources[1]).not.toContain("*");
  });
});

describe("the trigger", () => {
  it("exists and starts nothing, unless the schedule is switched on", () => {
    stack.hasResourceProperties("AWS::Glue::Trigger", {
      Type: "SCHEDULED",
      Schedule: "cron(0 1 * * ? *)",
      StartOnCreation: false,
      Actions: [{ JobName: { Ref: "Curate" } }],
    });
    synth(true).hasResourceProperties("AWS::Glue::Trigger", { StartOnCreation: true });
  });
});

describe("a run that fails", () => {
  it("matches a rule for this job only, in each state that leaves a day unwritten", () => {
    stack.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: {
        source: ["aws.glue"],
        "detail-type": ["Glue Job State Change"],
        detail: { jobName: [{ Ref: "Curate" }], state: ["FAILED", "TIMEOUT", "STOPPED"] },
      },
      Targets: [Match.objectLike({ Arn: { Ref: Match.stringLikeRegexp("^Failures") } })],
    });
  });

  it("lets only EventBridge publish to the topic", () => {
    const policy = only(stack, "AWS::SNS::TopicPolicy") as {
      PolicyDocument: { Statement: { Effect: string; Principal: unknown }[] };
    };
    expect(
      policy.PolicyDocument.Statement.filter((each) => each.Effect === "Allow").map(
        (each) => each.Principal,
      ),
    ).toEqual([{ Service: "events.amazonaws.com" }]);
  });

  it("raises an alarm that stays up for a day, and is quiet when nothing ran", () => {
    stack.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "AWS/Events",
      MetricName: "MatchedEvents",
      Dimensions: [{ Name: "RuleName", Value: { Ref: Match.stringLikeRegexp("^RunFailed") } }],
      Statistic: "Sum",
      Period: 86400,
      Threshold: 1,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      TreatMissingData: "notBreaching",
    });
  });
});

describe("the stack as a whole", () => {
  it("deletes everything that holds data with the stack", () => {
    for (const type of ["AWS::S3::Bucket", "AWS::Logs::LogGroup"]) {
      stack.allResources(type, { DeletionPolicy: "Delete", UpdateReplacePolicy: "Delete" });
    }
  });

  it("uses only resource types the pinned cdkd has its own code for", () => {
    const resources = stack.toJSON()["Resources"] as Record<string, { Type: string }>;
    expect(
      [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
    ).toEqual([
      "AWS::CloudWatch::Alarm",
      "AWS::Events::Rule",
      "AWS::Glue::Database",
      "AWS::Glue::Job",
      "AWS::Glue::Table",
      "AWS::Glue::Trigger",
      "AWS::IAM::Policy",
      "AWS::IAM::Role",
      "AWS::Logs::LogGroup",
      "AWS::S3::Bucket",
      "AWS::S3::BucketPolicy",
      "AWS::SNS::Topic",
      "AWS::SNS::TopicPolicy",
    ]);
  });
});
