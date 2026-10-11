import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";
import { DynamoDbAttachmentRepository } from "@aih/example-07-uploads/api/src/dynamodb-attachment-repository.ts";
import { S3ObjectStore } from "@aih/example-07-uploads/api/src/s3-object-store.ts";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDbInspectionRepository } from "./dynamodb-inspection-repository.ts";
import { parseFunctionEnv } from "./env.ts";
import { S3ObjectReader } from "./s3-object-reader.ts";
import { createBatchHandler } from "./worker.ts";

// #region handler
const env = parseFunctionEnv(process.env);
const s3 = new S3Client({});
const documents = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Invoked by the event source mapping with up to ten messages. What it
// returns tells Lambda which of them to leave in the queue.
export const handler = createBatchHandler({
  reader: new S3ObjectReader(s3, env.UPLOADS_BUCKET),
  inspections: new DynamoDbInspectionRepository(documents, env.TABLE_NAME),
  attachments: new DynamoDbAttachmentRepository(documents, env.TABLE_NAME),
  objects: new S3ObjectStore(s3, env.UPLOADS_BUCKET),
  now: () => new Date(),
  log: createLogger(env.LOG_LEVEL),
});
// #endregion handler
