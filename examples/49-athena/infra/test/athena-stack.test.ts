import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vite-plus/test";

import {
  AthenaStack,
  type AthenaStackProps,
  ENGINE_VERSION,
  RETENTION_DAYS,
  SCAN_LIMIT_BYTES,
} from "../lib/athena-stack.ts";

const synth = (props: Partial<AthenaStackProps> = {}) =>
  Template.fromStack(
    new AthenaStack(new App(), "AihAthena", { env: { region: "ap-northeast-1" }, ...props }),
  );

const alone = synth();
const withLake = synth({ lakeBucketName: "aihanalytics-lake-example" });

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
const statementsOf = (template: Template): Statement[] =>
  Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
    (policy) => policy["Properties"].PolicyDocument.Statement as Statement[],
  );
const actionsOf = (statement: Statement): string[] => [statement.Action].flat();
const only = (template: Template, type: string): Record<string, unknown> => {
  const found = Object.values(template.findResources(type));
  if (found.length !== 1) {
    throw new Error(`expected one ${type}, found ${String(found.length)}`);
  }
  return found[0]?.["Properties"] as Record<string, unknown>;
};

describe("the output bucket", () => {
  it("is private, encrypted, and refuses plain HTTP", () => {
    alone.hasResourceProperties("AWS::S3::Bucket", {
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
    const policy = only(alone, "AWS::S3::BucketPolicy") as {
      PolicyDocument: { Statement: (Statement & { Condition?: unknown })[] };
    };
    expect(policy.PolicyDocument.Statement).toHaveLength(1);
    expect(policy.PolicyDocument.Statement[0]).toMatchObject({
      Effect: "Deny",
      Condition: { Bool: { "aws:SecureTransport": "false" } },
    });
  });

  it("expires results and exports, ends unfinished uploads, and never expires a table's files", () => {
    const rules = (
      only(alone, "AWS::S3::Bucket")["LifecycleConfiguration"] as {
        Rules: Record<string, unknown>[];
      }
    ).Rules;
    expect(rules.map((rule) => [rule["Prefix"] ?? null, rule["ExpirationInDays"] ?? null])).toEqual(
      [
        ["results/", RETENTION_DAYS.results],
        ["exports/", RETENTION_DAYS.exports],
        [null, null],
      ],
    );
    expect(rules[2]).toMatchObject({ AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } });
    expect(JSON.stringify(rules)).not.toContain("tables/");
  });

  it("is deleted with the stack", () => {
    alone.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Delete" });
  });
});

describe("the workgroup", () => {
  const configuration = only(alone, "AWS::Athena::WorkGroup")["WorkGroupConfiguration"] as Record<
    string,
    unknown
  >;

  it("cancels a query past the scan limit, and no client can lift that", () => {
    expect(configuration).toMatchObject({
      BytesScannedCutoffPerQuery: SCAN_LIMIT_BYTES,
      EnforceWorkGroupConfiguration: true,
      PublishCloudWatchMetricsEnabled: true,
    });
    // Athena accepts limits from 10 MB up.
    expect(SCAN_LIMIT_BYTES).toBeGreaterThanOrEqual(10 * 1024 ** 2);
  });

  it("pins the engine version instead of following upgrades", () => {
    expect(configuration["EngineVersion"]).toEqual({ SelectedEngineVersion: ENGINE_VERSION });
  });

  it("writes results under results/ of its own bucket, encrypted, and only while this account owns it", () => {
    const result = configuration["ResultConfiguration"] as Record<string, unknown>;
    expect(JSON.stringify(result["OutputLocation"])).toMatch(/"s3:\/\/".*"\/results\/"/);
    expect(result).toMatchObject({
      EncryptionConfiguration: { EncryptionOption: "SSE_S3" },
      ExpectedBucketOwner: { Ref: "AWS::AccountId" },
    });
  });

  it("can be deleted with the stack although it holds saved queries", () => {
    alone.hasResourceProperties("AWS::Athena::WorkGroup", {
      Name: "aih-athena",
      RecursiveDeleteOption: true,
    });
  });
});

describe("the saved queries", () => {
  const queries = Object.values(alone.findResources("AWS::Athena::NamedQuery")).map(
    (query) => query["Properties"] as { Name: string; QueryString: unknown; Database: string },
  );

  it("are the six statements that need no value written into them, in this workgroup", () => {
    expect(queries.map((query) => query.Name).toSorted()).toEqual([
      "compact-days",
      "create-compact-table",
      "create-iceberg-table",
      "iceberg-events-yesterday",
      "iceberg-vacuum",
      "requests-for-route",
    ]);
    alone.allResourcesProperties("AWS::Athena::NamedQuery", {
      Database: "aih_analytics",
      WorkGroup: { Ref: "WorkGroup" },
    });
  });

  it("save question marks, never a value", () => {
    const route = queries.find((query) => query.Name === "requests-for-route");
    expect(route?.QueryString).toContain("AND route = ?");
    expect(JSON.stringify(queries)).not.toContain("2026-10-12");
  });

  it("put the derived tables under tables/, where nothing expires", () => {
    for (const name of ["create-compact-table", "create-iceberg-table"]) {
      const text = JSON.stringify(queries.find((query) => query.Name === name)?.QueryString);
      expect(text).toMatch(/\/tables\/requests_(compact|iceberg)\/'/);
      expect(text).not.toContain("results/");
    }
  });
});

describe("the analyst role", () => {
  const statements = statementsOf(withLake);

  it("is assumed from this account only, and carries no managed policy", () => {
    const role = only(alone, "AWS::IAM::Role") as {
      AssumeRolePolicyDocument: { Statement: { Principal: unknown }[] };
    };
    expect(JSON.stringify(role.AssumeRolePolicyDocument.Statement[0]?.Principal)).toContain(
      '{"Ref":"AWS::AccountId"},":root"',
    );
    expect(role).not.toHaveProperty("ManagedPolicyArns");
  });

  it("uses no wildcard action and no wildcard resource", () => {
    for (const statement of statements) {
      expect(statement.Effect).toBe("Allow");
      expect(actionsOf(statement).some((action) => action.includes("*"))).toBe(false);
      expect([statement.Resource].flat()).not.toContain("*");
    }
  });

  it("can run queries in this workgroup and in no other", () => {
    const athena = statements.filter((statement) =>
      actionsOf(statement).some((action) => action.startsWith("athena:")),
    );
    expect(athena).toHaveLength(1);
    expect(JSON.stringify(athena[0]?.Resource)).toContain(":workgroup/aih-athena");
    // It can neither change the limit it runs under nor save a query for others to run.
    expect(actionsOf(athena[0] as Statement).toSorted()).toEqual([
      "athena:BatchGetNamedQuery",
      "athena:GetNamedQuery",
      "athena:GetQueryExecution",
      "athena:GetQueryResults",
      "athena:GetWorkGroup",
      "athena:ListNamedQueries",
      "athena:StartQueryExecution",
      "athena:StopQueryExecution",
    ]);
  });

  it("reads one database and writes only the three derived tables", () => {
    const glue = statements.filter((statement) =>
      actionsOf(statement).some((action) => action.startsWith("glue:")),
    );
    const writing = glue.filter((statement) =>
      actionsOf(statement).some((action) => /Create|Update|Delete/.test(action)),
    );
    expect(writing).toHaveLength(1);
    expect(JSON.stringify(writing[0]?.Resource).match(/:table\/[a-z_/]+/g)).toEqual([
      ":table/aih_analytics/requests_compact",
      ":table/aih_analytics/requests_iceberg",
      ":table/aih_analytics/scratch_errors",
    ]);
    expect(glue.flatMap(actionsOf).filter((action) => action.includes("Database"))).toEqual([
      "glue:GetDatabase",
    ]);
  });

  it("deletes objects only under tables/", () => {
    const deleting = statements.filter((statement) =>
      actionsOf(statement).includes("s3:DeleteObject"),
    );
    expect(deleting).toHaveLength(1);
    expect(JSON.stringify(deleting[0]?.Resource)).toContain("/tables/*");
    expect(JSON.stringify(deleting[0]?.Resource)).not.toMatch(/results|exports/);
  });

  it("reads chapter 26's records, and only reads them", () => {
    const lake = statements.filter((statement) =>
      JSON.stringify(statement.Resource).includes("aihanalytics-lake-example"),
    );
    expect(lake.flatMap(actionsOf).toSorted()).toEqual([
      "s3:GetBucketLocation",
      "s3:GetObject",
      "s3:ListBucket",
    ]);
    const objects = lake.find((statement) => actionsOf(statement).includes("s3:GetObject"));
    expect(JSON.stringify(objects?.Resource)).toMatch(/requests_json\/\*.*requests_parquet\/\*/);
  });

  it("reaches no data bucket at all when chapter 26's is not named", () => {
    expect(JSON.stringify(statementsOf(alone))).not.toContain("aihanalytics-lake-example");
    expect(statementsOf(alone)).toHaveLength(statements.length - 2);
  });
});

describe("the stack", () => {
  it("uses only resource types that were checked against the pinned cdkd", () => {
    for (const template of [alone, withLake]) {
      const resources = template.toJSON()["Resources"] as Record<string, { Type: string }>;
      expect(
        [...new Set(Object.values(resources).map((resource) => resource.Type))].toSorted(),
      ).toEqual([
        // Cloud Control API in cdkd 0.296.28
        "AWS::Athena::NamedQuery",
        // Cloud Control API in cdkd 0.296.28
        "AWS::Athena::WorkGroup",
        "AWS::IAM::Policy",
        "AWS::IAM::Role",
        "AWS::S3::Bucket",
        "AWS::S3::BucketPolicy",
      ]);
    }
  });

  it("names no account and holds nothing billed by the hour", () => {
    const text = JSON.stringify(alone.toJSON());
    expect(text).not.toMatch(/\d{12}/);
    expect(text).not.toContain("AWS::Athena::CapacityReservation");
  });
});
