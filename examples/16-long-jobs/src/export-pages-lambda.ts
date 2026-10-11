import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Context } from "aws-lambda";
import { DynamoDbNoteSource } from "./dynamodb-note-source.ts";
import { parsePagesEnv } from "./env.ts";
import { type Progress, toProgress } from "./job.ts";
import { S3ExportStore } from "./s3-export-store.ts";
import { exportPages } from "./steps.ts";

// #region handler
const env = parsePagesEnv(process.env);
const log = createLogger(env.LOG_LEVEL);
const deps = {
  source: new DynamoDbNoteSource(DynamoDBDocumentClient.from(new DynamoDBClient({})), env.TABLE_NAME),
  store: new S3ExportStore(new S3Client({}), env.EXPORT_BUCKET),
};

// Called by the state machine: the state's input comes in, the return value is its output.
export const handler = async (
  event: unknown,
  context: Pick<Context, "getRemainingTimeInMillis">,
): Promise<Progress> => {
  const before = toProgress(event);
  const after = await exportPages(deps, before, {
    pageSize: env.PAGE_SIZE,
    // Returns well before Lambda would stop the function mid-page.
    mayContinue: () => context.getRemainingTimeInMillis() > env.RESERVE_SECONDS * 1000,
  });
  log({
    level: "info",
    message: "pages exported",
    exportId: after.exportId,
    parts: after.nextPart - before.nextPart,
    notes: after.notes - before.notes,
    done: after.done,
  });
  return after;
};
// #endregion handler
