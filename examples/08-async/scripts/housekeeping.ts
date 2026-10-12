// vp run async:housekeeping            lists what the scheduled function would do (reads AWS)
// vp run async:housekeeping --delete   does it now, with your credentials (changes AWS)
//   node scripts/housekeeping.ts [--delete]
//
// The same function the schedule starts every hour, run from a laptop. The
// deployed one runs under its own role; this one runs under yours.

import { parseArgs } from "node:util";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { DynamoDbNoteRepository } from "@aih/example-05-dynamodb/src/dynamodb-repository.ts";
import { DynamoDbAttachmentRepository } from "@aih/example-07-uploads/api/src/dynamodb-attachment-repository.ts";
import { S3ObjectStore } from "@aih/example-07-uploads/api/src/s3-object-store.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { DynamoDbInspectionRepository } from "../src/dynamodb-inspection-repository.ts";
import { housekeep } from "../src/housekeeping.ts";

const STACK = "AihAsync";
const { values } = parseArgs({ options: { delete: { type: "boolean", default: false } } });
const verb = values.delete ? "deleted" : "would delete";

try {
  const { target } = await preflight({
    access: values.delete ? "mutate" : "observe",
    action: values.delete ? "run housekeeping" : "list what housekeeping would do",
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const table = requireOutput(outputs, "TableName");
  const documents = DynamoDBDocumentClient.from(new DynamoDBClient({ region: target.region }));

  const report = await housekeep(
    {
      objects: new S3ObjectStore(
        new S3Client({ region: target.region }),
        requireOutput(outputs, "UploadsBucketName"),
      ),
      attachments: new DynamoDbAttachmentRepository(documents, table),
      notes: new DynamoDbNoteRepository(documents, table),
      inspections: new DynamoDbInspectionRepository(documents, table),
      now: () => new Date(),
    },
    { dryRun: !values.delete },
  );

  for (const item of report.orphans.removed) {
    console.log(`${verb} ${item.key} (${item.reason})`);
  }
  for (const item of report.rejected) {
    console.log(`${verb} ${item.key} and its record (inspection: ${item.reason})`);
  }
  for (const key of report.orphans.unknown) {
    console.log(`left alone: ${key} is not a key this app writes`);
  }
  console.log(
    `kept ${report.orphans.kept}, too young to judge ${report.orphans.tooYoung}, ` +
      `${values.delete ? "took" : "would take"} the pending tag off ${report.untagged} recent attached images`,
  );
  if (!values.delete) {
    console.log(
      "Nothing was changed. Pass --delete to do this now; the schedule does it every hour anyway.",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
