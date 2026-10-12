import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { DynamoDbTable } from "./dynamodb-table.ts";
import type { Env } from "./env.ts";

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

export function createTable(env: Env): DynamoDbTable {
  return new DynamoDbTable(DynamoDBDocumentClient.from(createClient(env)), env.TABLE_NAME);
}

/** Up to 50, 100, 200 ms, chosen at random, so colliding writers do not collide again in step. */
export const jitteredBackoff = (attempt: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.random() * 50 * 2 ** attempt));
