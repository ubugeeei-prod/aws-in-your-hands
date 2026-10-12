// vp run uploads:sweep            lists what would be removed (reads AWS)
// vp run uploads:sweep --delete   removes it (changes AWS)
//   node scripts/sweep.ts [--delete]
//
// Compares the uploads bucket with the table and removes objects that no
// attachment record, or no note, points at. Runs with your credentials, not
// the function's.

import { parseArgs } from "node:util";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { DynamoDbNoteRepository } from "@aih/example-05-dynamodb/src/dynamodb-repository.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { DynamoDbAttachmentRepository } from "../api/src/dynamodb-attachment-repository.ts";
import { S3ObjectStore } from "../api/src/s3-object-store.ts";
import { sweep } from "../api/src/sweep.ts";

const STACK = "AihUploads";
const { values } = parseArgs({ options: { delete: { type: "boolean", default: false } } });

try {
  const { target } = await preflight({
    access: values.delete ? "mutate" : "observe",
    action: values.delete ? "delete orphaned uploads" : "list orphaned uploads",
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const table = requireOutput(outputs, "TableName");
  const documents = DynamoDBDocumentClient.from(new DynamoDBClient({ region: target.region }));

  const report = await sweep(
    {
      objects: new S3ObjectStore(
        new S3Client({ region: target.region }),
        requireOutput(outputs, "UploadsBucketName"),
      ),
      attachments: new DynamoDbAttachmentRepository(documents, table),
      notes: new DynamoDbNoteRepository(documents, table),
      now: () => new Date(),
    },
    { dryRun: !values.delete },
  );

  for (const item of report.removed) {
    console.log(`${values.delete ? "deleted" : "would delete"} ${item.key} (${item.reason})`);
  }
  for (const key of report.unknown) {
    console.log(`left alone: ${key} is not a key this app writes`);
  }
  console.log(
    `kept ${report.kept}, too young to judge ${report.tooYoung}, ` +
      `${values.delete ? "deleted" : "would delete"} ${report.removed.length}`,
  );
  if (!values.delete && report.removed.length > 0) {
    console.log("Nothing was deleted. Pass --delete to remove these objects.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
