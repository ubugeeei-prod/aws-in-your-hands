import { S3Client } from "@aws-sdk/client-s3";
import * as v from "valibot";

import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";

import { parseFunctionEnv } from "./env.ts";
import { progressSchema } from "./job.ts";
import { S3ExportStore } from "./s3-export-store.ts";
import { type Finished, finishExport } from "./steps.ts";

const env = parseFunctionEnv(process.env);
const log = createLogger(env.LOG_LEVEL);
const store = new S3ExportStore(new S3Client({}), env.EXPORT_BUCKET);

export const handler = async (event: unknown): Promise<Finished> => {
  const finished = await finishExport({ store }, v.parse(progressSchema, event));
  log({ level: "info", message: "export finished", ...finished });
  return finished;
};
