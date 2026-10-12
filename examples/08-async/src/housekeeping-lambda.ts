import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { DynamoDbNoteRepository } from "@aih/example-05-dynamodb/src/dynamodb-repository.ts";
import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";
import { DynamoDbAttachmentRepository } from "@aih/example-07-uploads/api/src/dynamodb-attachment-repository.ts";
import { S3ObjectStore } from "@aih/example-07-uploads/api/src/s3-object-store.ts";

import { DynamoDbInspectionRepository } from "./dynamodb-inspection-repository.ts";
import { parseFunctionEnv } from "./env.ts";
import { housekeep } from "./housekeeping.ts";

// #region handler
const env = parseFunctionEnv(process.env);
const log = createLogger(env.LOG_LEVEL);
const documents = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Invoked by the schedule, once an hour. The event carries nothing this needs:
// what to clean up is read from the bucket and the table, every time.
export const handler = async (): Promise<void> => {
  const report = await housekeep(
    {
      objects: new S3ObjectStore(new S3Client({}), env.UPLOADS_BUCKET),
      attachments: new DynamoDbAttachmentRepository(documents, env.TABLE_NAME),
      notes: new DynamoDbNoteRepository(documents, env.TABLE_NAME),
      inspections: new DynamoDbInspectionRepository(documents, env.TABLE_NAME),
      now: () => new Date(),
    },
    { dryRun: false },
  );
  log({
    level: "info",
    message: "housekeeping finished",
    kept: report.orphans.kept,
    tooYoung: report.orphans.tooYoung,
    unknown: report.orphans.unknown.length,
    orphansRemoved: report.orphans.removed,
    rejectedRemoved: report.rejected,
    untagged: report.untagged,
  });
};
// #endregion handler
