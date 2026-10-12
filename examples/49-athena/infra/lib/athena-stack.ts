import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as athena from "aws-cdk-lib/aws-athena";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import { DATABASE } from "@aih/example-26-analytics/src/names.ts";
import { tableRoot } from "@aih/example-26-analytics/src/partition.ts";

import {
  COMPACT,
  compactDays,
  createCompactTable,
  createIcebergTable,
  eventsPerDayYesterday,
  ICEBERG,
  requestsForRoute,
  SCRATCH,
  vacuum,
  WORKGROUP,
} from "../../src/queries.ts";
import { type Statement, trusted } from "../../src/statement.ts";

export type AthenaStackProps = StackProps & {
  /** Chapter 26's bucket, from its LakeBucketName output. Left out, the role can read no records. */
  lakeBucketName?: string;
};

// #region bounds
// The most one query may read before Athena cancels it: about half a cent at USD 5 per TB.
export const SCAN_LIMIT_BYTES = 1024 ** 3;
// The SQL in this chapter was written against this engine. Auto upgrade would change it unasked.
export const ENGINE_VERSION = "Athena engine version 3";
// #endregion bounds

// #region layout
// One bucket for everything Athena writes, by what may be thrown away and when.
export const PREFIX = { results: "results/", tables: "tables/", exports: "exports/" } as const;
// Days a query result and an export are kept. Practice values. Tables are not expired at all.
export const RETENTION_DAYS = { results: 7, exports: 30 } as const;
// #endregion layout

const DERIVED = [COMPACT, ICEBERG, SCRATCH].map((name) => name.replace(".", "/"));

export class AthenaStack extends Stack {
  constructor(scope: Construct, id: string, props: AthenaStackProps) {
    super(scope, id, props);

    // #region bucket
    const bucket = new s3.Bucket(this, "Output", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          // Athena writes a result for every query and never deletes one.
          id: "expire-query-results",
          prefix: PREFIX.results,
          expiration: Duration.days(RETENTION_DAYS.results),
        },
        {
          id: "expire-exports",
          prefix: PREFIX.exports,
          expiration: Duration.days(RETENTION_DAYS.exports),
        },
        {
          // Athena writes in parts. A cancelled query can leave parts that are billed and never listed.
          id: "abort-incomplete-multipart-uploads",
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
        // No rule for tables/: an Iceberg table whose files expire under it is a broken table.
      ],
      // Exercise data: deleted with the stack, once emptied.
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion bucket

    // #region workgroup
    const workgroup = new athena.CfnWorkGroup(this, "WorkGroup", {
      name: WORKGROUP,
      description: "Chapter 49: every query capped in bytes scanned, results in one place",
      state: "ENABLED",
      // Without this, a workgroup that still holds named queries or history cannot be deleted.
      recursiveDeleteOption: true,
      workGroupConfiguration: {
        bytesScannedCutoffPerQuery: SCAN_LIMIT_BYTES,
        // A caller cannot send results elsewhere or drop the encryption from the client side.
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: true,
        engineVersion: { selectedEngineVersion: ENGINE_VERSION },
        resultConfiguration: {
          outputLocation: bucket.s3UrlForObject(PREFIX.results),
          encryptionConfiguration: { encryptionOption: "SSE_S3" },
          // Athena refuses to write results if the bucket has come to belong to another account.
          expectedBucketOwner: this.account,
        },
      },
    });
    // #endregion workgroup

    // #region named-queries
    const tables = (name: string) => trusted(bucket.s3UrlForObject(`${PREFIX.tables}${name}/`));
    const day = "2026-10-12";
    const saved: Record<string, { description: string; statement: Statement }> = {
      "requests-for-route": {
        description:
          "Answers per status for one route. Five parameters: two folders, two moments, the route",
        statement: requestsForRoute({ from: day, to: day, route: "/notes" }),
      },
      "create-compact-table": {
        description: "DDL, run once: the Parquet copy of the request records",
        statement: createCompactTable(tables("requests_compact")),
      },
      "compact-days": {
        description:
          "Copies days into the Parquet table. Two parameters. Run twice, it doubles the rows",
        statement: compactDays({ from: day, to: day }),
      },
      "create-iceberg-table": {
        description: "DDL, run once: the Iceberg table of the request records",
        statement: createIcebergTable(tables("requests_iceberg")),
      },
      "iceberg-events-yesterday": {
        description: "Time travel: events per day as the Iceberg table stood a day ago",
        statement: eventsPerDayYesterday(),
      },
      "iceberg-vacuum": {
        description:
          "Expires old snapshots and removes unreferenced files. Ends time travel past them",
        statement: vacuum(),
      },
    };
    for (const [name, { description, statement }] of Object.entries(saved)) {
      // Only the text is saved. The question marks stay, and whoever runs it supplies the values.
      new athena.CfnNamedQuery(this, `Query-${name}`, {
        name,
        description,
        database: DATABASE,
        queryString: statement.sql,
        workGroup: workgroup.ref,
      });
    }
    // #endregion named-queries

    // #region role
    // Anyone in this account whose own policy allows sts:AssumeRole on this role. Name people in production.
    const analyst = new iam.Role(this, "Analyst", {
      assumedBy: new iam.AccountRootPrincipal(),
      description: "Runs queries in the chapter 49 workgroup and nowhere else",
    });

    // The workgroup: run, watch, stop, read results, read the saved queries.
    analyst.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "athena:GetWorkGroup",
          "athena:StartQueryExecution",
          "athena:StopQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:ListNamedQueries",
          "athena:GetNamedQuery",
          "athena:BatchGetNamedQuery",
        ],
        resources: [
          this.formatArn({ service: "athena", resource: "workgroup", resourceName: WORKGROUP }),
        ],
      }),
    );

    // The catalog: read the one database. Glue checks a table's database and catalog too.
    const catalog = this.formatArn({ service: "glue", resource: "catalog" });
    const database = this.formatArn({
      service: "glue",
      resource: "database",
      resourceName: DATABASE,
    });
    const table = (name: string) =>
      this.formatArn({ service: "glue", resource: "table", resourceName: name });
    analyst.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "glue:GetDatabase",
          "glue:GetTable",
          "glue:GetTables",
          "glue:GetPartition",
          "glue:GetPartitions",
          "glue:BatchGetPartition",
        ],
        resources: [catalog, database, table(`${DATABASE}/*`)],
      }),
    );
    // Create, change and drop only the three tables this chapter derives.
    analyst.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "glue:CreateTable",
          "glue:UpdateTable",
          "glue:DeleteTable",
          "glue:CreatePartition",
          "glue:BatchCreatePartition",
        ],
        resources: [catalog, database, ...DERIVED.map(table)],
      }),
    );

    // This stack's bucket: read and write what Athena writes there.
    analyst.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetBucketLocation", "s3:ListBucket", "s3:ListBucketMultipartUploads"],
        resources: [bucket.bucketArn],
      }),
    );
    analyst.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts",
        ],
        resources: Object.values(PREFIX).map((prefix) => bucket.arnForObjects(`${prefix}*`)),
      }),
    );
    analyst.addToPolicy(
      new iam.PolicyStatement({
        // OPTIMIZE and VACUUM remove the files they replace. Results and exports are left to expire.
        actions: ["s3:DeleteObject"],
        resources: [bucket.arnForObjects(`${PREFIX.tables}*`)],
      }),
    );

    if (props.lakeBucketName !== undefined) {
      // Chapter 26's records: read only, and only the two folders the table can point at.
      const lake = s3.Bucket.fromBucketName(this, "Lake", props.lakeBucketName);
      analyst.addToPolicy(
        new iam.PolicyStatement({
          actions: ["s3:GetBucketLocation", "s3:ListBucket"],
          resources: [lake.bucketArn],
        }),
      );
      analyst.addToPolicy(
        new iam.PolicyStatement({
          actions: ["s3:GetObject"],
          resources: (["json", "parquet"] as const).map((format) =>
            lake.arnForObjects(`${tableRoot(format)}*`),
          ),
        }),
      );
    }
    // #endregion role

    new CfnOutput(this, "WorkGroupName", { value: workgroup.ref });
    new CfnOutput(this, "OutputBucketName", { value: bucket.bucketName });
    new CfnOutput(this, "TablesLocation", { value: bucket.s3UrlForObject(PREFIX.tables) });
    new CfnOutput(this, "ExportsLocation", { value: bucket.s3UrlForObject(PREFIX.exports) });
    new CfnOutput(this, "AnalystRoleArn", { value: analyst.roleArn });
  }
}
