import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDurableExport } from "./durable-export.ts";
import { DynamoDbNoteSource } from "./dynamodb-note-source.ts";
import { parsePagesEnv } from "./env.ts";
import { S3ExportStore } from "./s3-export-store.ts";

const env = parsePagesEnv(process.env);

export const handler = createDurableExport(
  {
    source: new DynamoDbNoteSource(DynamoDBDocumentClient.from(new DynamoDBClient({})), env.TABLE_NAME),
    store: new S3ExportStore(new S3Client({}), env.EXPORT_BUCKET),
  },
  // Twenty pages a step: a checkpoint every 2,000 notes at the default page size.
  { pageSize: env.PAGE_SIZE, pagesPerStep: 20 },
);
