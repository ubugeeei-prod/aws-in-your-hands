import { randomBytes, randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { type App, createApp } from "./app.ts";
import { DynamoDbNoteRepository } from "./dynamodb-repository.ts";
import { type Env, parseEnv } from "./env.ts";
import { createLogger } from "./log.ts";
import { InMemoryNoteRepository } from "./memory-repository.ts";
import { createNoteService } from "./notes.ts";
import type { NoteRepository } from "./repository.ts";

// #region repository
export function createRepository(env: Env): NoteRepository {
  if (env.NOTES_STORE === "memory") {
    return new InMemoryNoteRepository();
  }
  // Workers hands a D1 database or KV namespace to the code as a binding.
  // Here the connection is assembled by hand from three separate things: the
  // table's name (configuration), the SDK client (code), and permission to use
  // the table (the execution role in AWS, your own credentials on a laptop).
  const client = new DynamoDBClient(
    env.DYNAMODB_ENDPOINT === undefined
      ? {}
      : {
          endpoint: env.DYNAMODB_ENDPOINT,
          region: "ap-northeast-1",
          // DynamoDB Local accepts any credentials; these are not real ones.
          credentials: { accessKeyId: "local", secretAccessKey: "local" },
        },
  );
  return new DynamoDbNoteRepository(DynamoDBDocumentClient.from(client), env.TABLE_NAME);
}
// #endregion repository

export function composeApp(source: Record<string, string | undefined>): App {
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
