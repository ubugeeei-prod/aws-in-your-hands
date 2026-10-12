import { S3Client } from "@aws-sdk/client-s3";

import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";

import { parseFunctionEnv } from "./env.ts";
import { progressSchema } from "./job.ts";
import { S3ExportStore } from "./s3-export-store.ts";
import { type Discarded, discardExport } from "./steps.ts";

const env = parseFunctionEnv(process.env);
const log = createLogger(env.LOG_LEVEL);
const store = new S3ExportStore(new S3Client({}), env.EXPORT_BUCKET);

// The Catch hands over the failed state's input with an `error` field added. Only the ID is needed.
export const handler = async (event: unknown): Promise<Discarded> => {
  const discarded = await discardExport(
    { store },
    progressSchema.pick({ exportId: true }).parse(event),
  );
  log({ level: "warn", message: "export discarded", ...discarded });
  return discarded;
};
