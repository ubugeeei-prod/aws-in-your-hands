import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { type Audit, audit } from "./audit.ts";
import { DynamoDbTable } from "./dynamodb-table.ts";
import { S3VersionedBucket } from "./s3-versioned-bucket.ts";

// #region handler
// Which table "the" table is comes from the environment, and from nowhere
// else. After a restore, changing this one value is the cutover.
const env = z.object({ TABLE_NAME: z.string().min(3), UPLOADS_BUCKET: z.string().min(3) }).parse(process.env);

const table = new DynamoDbTable(DynamoDBDocumentClient.from(new DynamoDBClient({})), env.TABLE_NAME);
const bucket = new S3VersionedBucket(new S3Client({}), env.UPLOADS_BUCKET);

export async function handler(): Promise<Audit> {
  const { report: _report, ...summary } = await audit({
    tableName: env.TABLE_NAME,
    table,
    bucket,
    now: () => new Date(),
  });
  console.log(JSON.stringify({ level: summary.broken > 0 ? "error" : "info", message: "audit", ...summary }));
  return summary;
}
// #endregion handler
