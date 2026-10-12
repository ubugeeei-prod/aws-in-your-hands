import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import type { DigestStore } from "./digest.ts";
import { dynamoDbJournal } from "./dynamodb-journal.ts";
import type { Env } from "./env.ts";
import type { Journal } from "./journal.ts";
import { S3Digests } from "./s3-digests.ts";

export function createClient(env: Env): DynamoDBClient {
  return new DynamoDBClient(
    env.DYNAMODB_ENDPOINT === undefined
      ? {}
      : {
          endpoint: env.DYNAMODB_ENDPOINT,
          region: "ap-northeast-1",
          // DynamoDB Local accepts any credentials; these are not real ones.
          credentials: { accessKeyId: "local", secretAccessKey: "local" },
        },
  );
}

export const createJournal = (env: Env): Journal =>
  dynamoDbJournal(DynamoDBDocumentClient.from(createClient(env)), env.TABLE_NAME);

export function createDigests(env: Env): DigestStore {
  if (env.DIGEST_BUCKET === undefined) {
    throw new Error("DIGEST_BUCKET is not set.");
  }
  return new S3Digests(new S3Client({}), env.DIGEST_BUCKET);
}
