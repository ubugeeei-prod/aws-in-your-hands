import { randomBytes, randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { createRepository } from "@aih/example-05-dynamodb/src/compose.ts";
import { type Env, parseEnv } from "@aih/example-05-dynamodb/src/env.ts";
import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";
import { createNoteService } from "@aih/example-05-dynamodb/src/notes.ts";
import { MAX_NOTES_PER_OWNER } from "@aih/example-06-auth/api/src/contract.ts";
import type { Authenticate } from "@aih/example-06-auth/api/src/identity.ts";

import { type App, createApp } from "./app.ts";
import { DynamoDbRoomStore } from "./dynamodb-room-store.ts";
import type { MeetingsGateway } from "./meetings.ts";
import { InMemoryRoomStore, type RoomStore } from "./room-store.ts";
import { createRoomService } from "./rooms.ts";

export function createRoomStore(env: Env): RoomStore {
  if (env.NOTES_STORE === "memory") {
    return new InMemoryRoomStore();
  }
  const client = new DynamoDBClient(
    env.DYNAMODB_ENDPOINT === undefined
      ? {}
      : {
          endpoint: env.DYNAMODB_ENDPOINT,
          region: "ap-northeast-1",
          credentials: { accessKeyId: "local", secretAccessKey: "local" },
        },
  );
  return new DynamoDbRoomStore(DynamoDBDocumentClient.from(client), env.TABLE_NAME);
}

/** The entry point decides who vouches for the caller and what stands behind a meeting. */
export function composeApp(
  source: Record<string, string | undefined>,
  authenticate: Authenticate,
  meetings: MeetingsGateway,
): App {
  const env = parseEnv(source);
  return createApp({
    env,
    authenticate,
    log: createLogger(env.LOG_LEVEL),
    notes: createNoteService({
      repository: createRepository(env, MAX_NOTES_PER_OWNER),
      now: () => new Date(),
      randomSuffix: () => randomBytes(5).toString("hex"),
    }),
    rooms: createRoomService({ store: createRoomStore(env), meetings, newId: randomUUID }),
    newRequestId: randomUUID,
    now: Date.now,
  });
}
