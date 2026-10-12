import { randomBytes, randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
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

import { TABLE_CLIENT_RETRY } from "./sdk-retry.ts";

// #region repository
// Chapter 05's repository, with a client whose retries are stated here.
export function createRepository(env: Env): NoteRepository {
  if (env.NOTES_STORE === "memory") {
    return new InMemoryNoteRepository(MAX_NOTES_PER_OWNER);
  }
  const client = new DynamoDBClient({
    ...TABLE_CLIENT_RETRY,
    ...(env.DYNAMODB_ENDPOINT === undefined
      ? {}
      : {
          endpoint: env.DYNAMODB_ENDPOINT,
          region: "ap-northeast-1",
          // DynamoDB Local accepts any credentials; these are not real ones.
          credentials: { accessKeyId: "local", secretAccessKey: "local" },
        }),
  });
  return new DynamoDbNoteRepository(
    DynamoDBDocumentClient.from(client),
    env.TABLE_NAME,
    MAX_NOTES_PER_OWNER,
  );
}
// #endregion repository

export function composeApp(source: Record<string, string | undefined>): Fetch {
  const env = parseEnv(source);
  return createApp({
    env,
    log: createLogger(env.LOG_LEVEL),
    notes: createNoteService({
      repository: createRepository(env),
      now: () => new Date(),
      randomSuffix: () => randomBytes(5).toString("hex"),
    }),
    newRequestId: randomUUID,
    now: Date.now,
  });
}
