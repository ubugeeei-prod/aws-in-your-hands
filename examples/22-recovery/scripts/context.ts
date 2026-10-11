import { parseArgs } from "node:util";
import { DynamoDbNoteRepository } from "@aih/example-05-dynamodb/src/dynamodb-repository.ts";
import { DynamoDbAttachmentRepository } from "@aih/example-07-uploads/api/src/dynamodb-attachment-repository.ts";
import { S3ObjectStore } from "@aih/example-07-uploads/api/src/s3-object-store.ts";
import { DynamoDbInspectionRepository } from "@aih/example-08-async/src/dynamodb-inspection-repository.ts";
import { S3ObjectReader } from "@aih/example-08-async/src/s3-object-reader.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbTable } from "../src/dynamodb-table.ts";
import { S3VersionedBucket } from "../src/s3-versioned-bucket.ts";

export const STACK = "AihRecovery";

// #region flags
export const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    // Without it, every command that changes AWS only prints what it would do.
    apply: { type: "boolean", default: false },
    // A table other than the one the stack currently points at: usually a restored one.
    table: { type: "string" },
    // A point in time, ISO 8601.
    at: { type: "string" },
    // Writes are stopped, so nothing is "still being uploaded": check without the grace period.
    frozen: { type: "boolean", default: false },
    fence: { type: "boolean", default: false },
  },
});
// #endregion flags

export function pointInTime(): Date | undefined {
  if (flags.at === undefined) {
    return undefined;
  }
  const at = new Date(flags.at);
  if (Number.isNaN(at.getTime())) {
    throw new Error(`--at ${flags.at} is not a time. Use ISO 8601, such as 2026-10-12T09:00:00Z.`);
  }
  return at;
}

/** Preflight, the stack's outputs, and clients. `change` is honoured only together with --apply. */
export async function connect(action: string, options: { change: boolean }) {
  const mutate = options.change && flags.apply;
  const { target } = await preflight({ access: mutate ? "mutate" : "observe", action, stack: STACK });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const dynamodb = new DynamoDBClient({ region: target.region });
  const documents = DynamoDBDocumentClient.from(dynamodb);
  const s3 = new S3Client({ region: target.region });
  const bucketName = requireOutput(outputs, "UploadsBucketName");
  const activeTable = requireOutput(outputs, "TableName");

  const open = (tableName: string) => ({
    tableName,
    table: new DynamoDbTable(documents, tableName),
    notes: new DynamoDbNoteRepository(documents, tableName),
    attachments: new DynamoDbAttachmentRepository(documents, tableName),
    inspections: new DynamoDbInspectionRepository(documents, tableName),
  });

  return {
    region: target.region,
    dryRun: !mutate,
    dynamodb,
    s3,
    bucketName,
    /** The table the deployed function reads. */
    activeTable,
    /** The table the stack created. The same as `activeTable` until a cutover. */
    ownedTable: requireOutput(outputs, "OwnedTableName"),
    auditFunctionName: requireOutput(outputs, "AuditFunctionName"),
    bucket: new S3VersionedBucket(s3, bucketName),
    objects: new S3ObjectStore(s3, bucketName),
    reader: new S3ObjectReader(s3, bucketName),
    open,
    /** --table, or the active table. */
    chosen: () => open(flags.table ?? activeTable),
  };
}

export type Context = Awaited<ReturnType<typeof connect>>;

export const verb = (dryRun: boolean, done: string, planned: string): string => (dryRun ? planned : done);

export function remindToApply(dryRun: boolean): void {
  if (dryRun) {
    console.log("\nNothing was changed. Run the same command with --apply to do it.");
  }
}
