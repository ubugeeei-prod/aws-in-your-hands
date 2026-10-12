import { randomBytes, randomUUID } from "node:crypto";

import { DynamoDBClient, type DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";
import { createApp } from "@aih/example-05-dynamodb/src/app.ts";
import { MAX_NOTES_PER_OWNER } from "@aih/example-05-dynamodb/src/contract.ts";
import { DynamoDbNoteRepository } from "@aih/example-05-dynamodb/src/dynamodb-repository.ts";
import { type Env, parseEnv } from "@aih/example-05-dynamodb/src/env.ts";
import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";
import { InMemoryNoteRepository } from "@aih/example-05-dynamodb/src/memory-repository.ts";
import { createNoteService } from "@aih/example-05-dynamodb/src/notes.ts";
import type { NoteRepository } from "@aih/example-05-dynamodb/src/repository.ts";

import { obeyDeadline } from "./deadline.ts";
import { SDK } from "./timeouts.ts";

type DocumentClient = Pick<DynamoDBDocumentClient, "send">;

// #region client
/** Chapter 05's client settings plus the timeouts and the attempt count the SDK leaves open. */
export function clientConfig(env: Env): DynamoDBClientConfig {
  const local =
    env.NOTES_STORE === "dynamodb" && env.DYNAMODB_ENDPOINT !== undefined
      ? {
          endpoint: env.DYNAMODB_ENDPOINT,
          region: "ap-northeast-1",
          // DynamoDB Local accepts any credentials; these are not real ones.
          credentials: { accessKeyId: "local", secretAccessKey: "local" },
        }
      : {};
  return {
    ...local,
    maxAttempts: SDK.maxAttempts,
    requestHandler: {
      connectionTimeout: SDK.connectionTimeoutMs,
      requestTimeout: SDK.requestTimeoutMs,
      // Without this the request timeout only logs a warning.
      throwOnRequestTimeout: true,
    },
  };
}

// Only the client and the commands the repository sends end up in the bundle.
export const modularClient = (config: DynamoDBClientConfig): DocumentClient =>
  DynamoDBDocumentClient.from(new DynamoDBClient(config));
// #endregion client

// #region compose
/**
 * Called once, outside the handler: the client, its connection pool and the resolved
 * credentials then live as long as the execution environment does.
 */
export function composeTunedApp(
  source: Record<string, string | undefined>,
  makeClient: (config: DynamoDBClientConfig) => DocumentClient = modularClient,
): Fetch {
  const env = parseEnv(source);
  const repository: NoteRepository =
    env.NOTES_STORE === "memory"
      ? new InMemoryNoteRepository(MAX_NOTES_PER_OWNER)
      : new DynamoDbNoteRepository(
          obeyDeadline(makeClient(clientConfig(env))),
          env.TABLE_NAME,
          MAX_NOTES_PER_OWNER,
        );
  return createApp({
    env,
    log: createLogger(env.LOG_LEVEL),
    notes: createNoteService({
      repository,
      now: () => new Date(),
      randomSuffix: () => randomBytes(5).toString("hex"),
    }),
    newRequestId: randomUUID,
    now: Date.now,
  });
}
// #endregion compose
