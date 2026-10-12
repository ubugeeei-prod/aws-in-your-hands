import { S3VectorsClient } from "@aws-sdk/client-s3vectors";

import { createLogger } from "@aih/example-04-http-api/src/log.ts";

import { createTitanEmbedder } from "./bedrock-embedder.ts";
import { parseIndexerEnv } from "./env.ts";
import { createIndexer } from "./indexer.ts";
import { createS3VectorsIndex } from "./s3-vectors-index.ts";
import { createStreamHandler } from "./stream.ts";

// #region handler
const env = parseIndexerEnv(process.env);
const log = createLogger(env.LOG_LEVEL);

export const handler = createStreamHandler({
  indexer: createIndexer({
    embedder: createTitanEmbedder(env.AWS_REGION, (tokens) =>
      log({ level: "info", message: "embedded", tokens }),
    ),
    index: createS3VectorsIndex(
      new S3VectorsClient({ region: env.AWS_REGION }),
      env.VECTOR_INDEX_ARN,
    ),
  }),
  log,
});
// #endregion handler
