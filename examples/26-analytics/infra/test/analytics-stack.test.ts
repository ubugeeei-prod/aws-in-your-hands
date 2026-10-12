import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import { evaluatePrefix } from "../../src/partition.ts";
import { COLUMNS } from "../../src/record.ts";
import {
  AnalyticsStack,
  type AnalyticsStackProps,
  BYTES_SCANNED_CUTOFF,
  RETENTION_DAYS,
} from "../lib/analytics-stack.ts";

const synth = (props: Partial<AnalyticsStackProps> = {}) =>
  Template.fromStack(
    new AnalyticsStack(new App(), "AihAnalytics", {
      env: { region: "ap-northeast-1" },
      allowedOrigin: "https://d111.cloudfront.net",
      format: "json",
      ...props,
    }),
  );

// Synthesized once each: every synth bundles the function with esbuild.
const json = synth();
const parquet = synth({ format: "parquet" });
const both = [
  ["json", json],
  ["parquet", parquet],
] as const;

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
const statementsOf = (template: Template, role: string): Statement[] =>
  Object.values(template.findResources("AWS::IAM::Policy"))
    .filter((policy) => JSON.stringify(policy["Properties"].Roles).includes(role))
    .flatMap((policy) => policy["Properties"].PolicyDocument.Statement as Statement[]);

const only = (template: Template, type: string): Record<string, unknown> => {
  const found = Object.values(template.findResources(type));
  if (found.length !== 1) {
    throw new Error(`expected one ${type}, found ${String(found.length)}`);
  }
  return found[0]?.["Properties"] as Record<string, unknown>;
};

describe("the bucket", () => {
  it("is private, encrypted, and refuses plain HTTP", () => {
    json.resourceCountIs("AWS::S3::Bucket", 1);
    json.hasResourceProperties("AWS::S3::Bucket", {
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
    const policy = only(json, "AWS::S3::BucketPolicy") as {
      PolicyDocument: { Statement: (Statement & { Condition?: unknown; Principal?: unknown })[] };
    };
    // One statement, and it is a refusal: nobody is given access through the bucket policy.
    expect(policy.PolicyDocument.Statement).toHaveLength(1);
    expect(policy.PolicyDocument.Statement[0]).toMatchObject({
      Effect: "Deny",
      Condition: { Bool: { "aws:SecureTransport": "false" } },
    });
  });

  it("expires every folder something writes to, and unfinished uploads", () => {
    const rules = (
      only(json, "AWS::S3::Bucket")["LifecycleConfiguration"] as {
        Rules: Record<string, unknown>[];
      }
    ).Rules;
    expect(rules.map((rule) => [rule["Prefix"] ?? null, rule["ExpirationInDays"] ?? null])).toEqual(
      [
        ["requests_json/", RETENTION_DAYS.records],
        ["requests_parquet/", RETENTION_DAYS.records],
        ["errors/", RETENTION_DAYS.errors],
        ["athena-results/", RETENTION_DAYS.results],
        [null, null],
      ],
    );
    expect(rules.at(-1)).toMatchObject({
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
      Status: "Enabled",
    });
  });

  it("is deleted with the stack, as practice data", () => {
    json.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });
});

describe("the table Athena reads", () => {
  it("lists the record's fields as columns, and dt as the only partition key", () => {
    for (const [, template] of both) {
      const input = only(template, "AWS::Glue::Table")["TableInput"] as {
        Name: string;
        TableType: string;
        PartitionKeys: unknown;
        StorageDescriptor: { Columns: unknown };
      };
      expect(input.Name).toBe("requests");
      expect(input.TableType).toBe("EXTERNAL_TABLE");
      expect(input.PartitionKeys).toEqual([{ Name: "dt", Type: "string" }]);
      expect(input.StorageDescriptor.Columns).toEqual(
        COLUMNS.map(({ name, type }) => ({ Name: name, Type: type })),
      );
    }
  });

  it("projects its partitions onto the folder the stream writes", () => {
    for (const [format, template] of both) {
      const input = only(template, "AWS::Glue::Table")["TableInput"] as {
        Parameters: Record<string, unknown>;
        StorageDescriptor: { Location: unknown };
      };
      const stream = only(template, "AWS::KinesisFirehose::DeliveryStream")[
        "ExtendedS3DestinationConfiguration"
      ] as { Prefix: string };

      expect(input.Parameters).toMatchObject({
        classification: format,
        "projection.enabled": "true",
        "projection.dt.type": "date",
        "projection.dt.range": "2026-10-01,NOW",
      });
      // Both are "s3://<bucket>/" followed by a path. The paths must be the same folder.
      const template2 = JSON.stringify(input.Parameters["storage.location.template"]);
      const written = evaluatePrefix(stream.Prefix, new Date("2026-10-12T12:00:00Z"));
      expect(written).toBe(`requests_${format}/dt=2026-10-12/`);
      expect(template2).toContain(`/requests_${format}/dt=\${dt}/`);
      expect(JSON.stringify(input.StorageDescriptor.Location)).toContain(`/requests_${format}/`);
    }
  });

  it("is read with the SerDe that fits the files", () => {
    json.hasResourceProperties("AWS::Glue::Table", {
      TableInput: {
        StorageDescriptor: {
          InputFormat: "org.apache.hadoop.mapred.TextInputFormat",
          SerdeInfo: { SerializationLibrary: "org.apache.hive.hcatalog.data.JsonSerDe" },
        },
      },
    });
    parquet.hasResourceProperties("AWS::Glue::Table", {
      TableInput: {
        StorageDescriptor: {
          InputFormat: "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
          SerdeInfo: {
            SerializationLibrary: "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
          },
        },
      },
    });
  });
});

describe("the delivery stream", () => {
  it("writes gzip JSON under a date prefix, with an error prefix beside it", () => {
    json.hasResourceProperties("AWS::KinesisFirehose::DeliveryStream", {
      DeliveryStreamType: "DirectPut",
      ExtendedS3DestinationConfiguration: {
        Prefix: "requests_json/dt=!{timestamp:yyyy-MM-dd}/",
        ErrorOutputPrefix: "errors/!{firehose:error-output-type}/!{timestamp:yyyy-MM-dd}/",
        CompressionFormat: "GZIP",
        BufferingHints: { IntervalInSeconds: 60, SizeInMBs: 5 },
        CloudWatchLoggingOptions: { Enabled: true },
        DataFormatConversionConfiguration: Match.absent(),
        // Not used: it bills per GB and per object, and the pinned cdkd does not pass it on.
        DynamicPartitioningConfiguration: Match.absent(),
      },
    });
  });

  it("converts to Parquet from the same table, and does not compress the file again", () => {
    parquet.hasResourceProperties("AWS::KinesisFirehose::DeliveryStream", {
      ExtendedS3DestinationConfiguration: {
        Prefix: "requests_parquet/dt=!{timestamp:yyyy-MM-dd}/",
        CompressionFormat: "UNCOMPRESSED",
        BufferingHints: { IntervalInSeconds: 300, SizeInMBs: 64 },
        DataFormatConversionConfiguration: {
          Enabled: true,
          InputFormatConfiguration: { Deserializer: { OpenXJsonSerDe: {} } },
          OutputFormatConfiguration: { Serializer: { ParquetSerDe: {} } },
          SchemaConfiguration: {
            DatabaseName: "aih_analytics",
            TableName: "requests",
            Region: "ap-northeast-1",
            VersionId: "LATEST",
          },
        },
      },
    });
  });
});

describe("the workgroup", () => {
  it("cancels a query past the cap, and lets no client lift it", () => {
    json.hasResourceProperties("AWS::Athena::WorkGroup", {
      Name: "aih-analytics",
      State: "ENABLED",
      RecursiveDeleteOption: true,
      WorkGroupConfiguration: {
        BytesScannedCutoffPerQuery: BYTES_SCANNED_CUTOFF,
        EnforceWorkGroupConfiguration: true,
        PublishCloudWatchMetricsEnabled: true,
        ResultConfiguration: { EncryptionConfiguration: { EncryptionOption: "SSE_S3" } },
      },
    });
    // Athena accepts no cap below 10 MB.
    expect(BYTES_SCANNED_CUTOFF).toBeGreaterThanOrEqual(10 * 1024 ** 2);
    expect(BYTES_SCANNED_CUTOFF).toBe(1_073_741_824);
  });

  it("writes results under the prefix that expires", () => {
    const configuration = only(json, "AWS::Athena::WorkGroup")["WorkGroupConfiguration"] as {
      ResultConfiguration: { OutputLocation: unknown };
    };
    expect(JSON.stringify(configuration.ResultConfiguration.OutputLocation)).toContain(
      "/athena-results/",
    );
  });
});

describe("permissions", () => {
  it("lets the function add records to its stream, and touch nothing else of the lake", () => {
    for (const [, template] of both) {
      const statements = statementsOf(template, "HandlerRole");
      const actions = statements.flatMap((statement) => [statement.Action].flat());

      expect(actions.filter((action) => !action.startsWith("dynamodb:")).toSorted()).toEqual([
        "firehose:PutRecord",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ]);
      const put = statements.find((statement) => statement.Action === "firehose:PutRecord");
      expect(put?.Resource).toEqual({ "Fn::GetAtt": ["Delivery", "Arn"] });
    }
  });

  it("lets Firehose write only its own folders", () => {
    for (const [format, template] of both) {
      const statements = statementsOf(template, "DeliveryRole");
      const objects = statements.find((statement) =>
        [statement.Action].flat().includes("s3:PutObject"),
      );
      const resources = JSON.stringify(objects?.Resource);

      expect(resources).toContain(`/requests_${format}/*`);
      expect(resources).toContain("/errors/*");
      expect(resources).not.toContain("athena-results");
      expect(resources).not.toContain(format === "json" ? "requests_parquet" : "requests_json");
      expect([objects?.Action].flat().toSorted()).toEqual([
        "s3:AbortMultipartUpload",
        "s3:GetObject",
        "s3:PutObject",
      ]);
    }
  });

  it("lets Firehose read the table definition only when it converts", () => {
    const glueActions = (template: Template) =>
      statementsOf(template, "DeliveryRole")
        .flatMap((statement) => [statement.Action].flat())
        .filter((action) => action.startsWith("glue:"))
        .toSorted();
    expect(glueActions(json)).toEqual([]);
    expect(glueActions(parquet)).toEqual([
      "glue:GetTable",
      "glue:GetTableVersion",
      "glue:GetTableVersions",
    ]);
  });

  it("uses no wildcard action, no wildcard resource, and no managed policy", () => {
    for (const [, template] of both) {
      const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
        (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
      );
      expect(statements.length).toBeGreaterThan(4);
      for (const statement of statements) {
        expect(statement.Effect).toBe("Allow");
        expect(JSON.stringify(statement.Resource)).not.toBe('"*"');
        for (const action of [statement.Action].flat()) {
          expect(action).not.toContain("*");
        }
      }
      template.allResourcesProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
    }
  });

  it("trusts only the two services that need a role", () => {
    const principals = Object.values(json.findResources("AWS::IAM::Role"))
      .map((role) =>
        JSON.stringify(role["Properties"].AssumeRolePolicyDocument.Statement[0].Principal),
      )
      .toSorted();
    expect(principals).toEqual([
      '{"Service":"firehose.amazonaws.com"}',
      '{"Service":"lambda.amazonaws.com"}',
    ]);
  });
});

describe("the stack as a whole", () => {
  it("gives the function the stream's name and keeps chapter 19's bounds", () => {
    json.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: { DELIVERY_STREAM_NAME: { Ref: "Delivery" } },
      },
    });
    json.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      DefaultRouteSettings: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 },
    });
    json.hasResourceProperties("AWS::DynamoDB::Table", {
      OnDemandThroughput: { MaxReadRequestUnits: 150, MaxWriteRequestUnits: 40 },
    });
  });

  it("deletes everything that holds data with the stack", () => {
    for (const type of ["AWS::S3::Bucket", "AWS::DynamoDB::Table", "AWS::Logs::LogGroup"]) {
      json.allResources(type, { DeletionPolicy: "Delete", UpdateReplacePolicy: "Delete" });
    }
    json.allResourcesProperties("AWS::Logs::LogGroup", { RetentionInDays: 7 });
  });

  it("uses only resource types that were checked against the pinned cdkd", () => {
    for (const [, template] of both) {
      const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
      expect(
        [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
      ).toEqual([
        "AWS::ApiGatewayV2::Api",
        "AWS::ApiGatewayV2::Integration",
        "AWS::ApiGatewayV2::Route",
        "AWS::ApiGatewayV2::Stage",
        // Cloud Control API in cdkd 0.296.28
        "AWS::Athena::WorkGroup",
        "AWS::DynamoDB::Table",
        "AWS::Glue::Database",
        "AWS::Glue::Table",
        "AWS::IAM::Policy",
        "AWS::IAM::Role",
        "AWS::KinesisFirehose::DeliveryStream",
        "AWS::Lambda::Function",
        "AWS::Lambda::Permission",
        "AWS::Logs::LogGroup",
        // Cloud Control API in cdkd 0.296.28
        "AWS::Logs::LogStream",
        "AWS::S3::Bucket",
        "AWS::S3::BucketPolicy",
      ]);
    }
  });
});
