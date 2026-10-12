import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3VectorsClient } from "@aws-sdk/client-s3vectors";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import type { Logger } from "@aih/example-04-http-api/src/log.ts";
import { DynamoDbNoteRepository } from "@aih/example-05-dynamodb/src/dynamodb-repository.ts";
import { createBedrockGateway } from "@aih/example-17-ai/src/bedrock.ts";

import { createTitanEmbedder } from "./bedrock-embedder.ts";
import type { Parts } from "./compose.ts";
import { createS3VectorsIndex } from "./s3-vectors-index.ts";

// #region aws
/** The parts that call AWS. Each is a client and a name: the permission is the execution role's. */
export function awsParts(
  env: {
    TABLE_NAME: string;
    VECTOR_INDEX_ARN: string;
    BEDROCK_MODEL_ID: string;
    AWS_REGION: string;
  },
  log: Logger,
): Parts {
  return {
    notes: new DynamoDbNoteRepository(
      DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.AWS_REGION })),
      env.TABLE_NAME,
    ),
    embedder: createTitanEmbedder(env.AWS_REGION, (tokens) =>
      log({ level: "info", message: "embedded", tokens }),
    ),
    index: createS3VectorsIndex(
      new S3VectorsClient({ region: env.AWS_REGION }),
      env.VECTOR_INDEX_ARN,
    ),
    gateway: createBedrockGateway(env.AWS_REGION),
    modelId: env.BEDROCK_MODEL_ID,
  };
}
// #endregion aws
