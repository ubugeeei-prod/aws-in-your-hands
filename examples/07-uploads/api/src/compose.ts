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
import {
  type AttachmentRepository,
  InMemoryAttachmentRepository,
} from "./attachment-repository.ts";
import { createAttachmentService } from "./attachments.ts";
import { DynamoDbAttachmentRepository } from "./dynamodb-attachment-repository.ts";
import type { ObjectStore } from "./object-store.ts";
import { DynamoDbPermitLedger, InMemoryPermitLedger, type PermitLedger } from "./permit-ledger.ts";

// The same table as the notes, reached the same way as in chapter 05.
const documentClient = (env: Extract<Env, { NOTES_STORE: "dynamodb" }>): DynamoDBDocumentClient =>
  DynamoDBDocumentClient.from(
    new DynamoDBClient(
      env.DYNAMODB_ENDPOINT === undefined
        ? {}
        : {
            endpoint: env.DYNAMODB_ENDPOINT,
            region: "ap-northeast-1",
            credentials: { accessKeyId: "local", secretAccessKey: "local" },
          },
    ),
  );

export function createAttachmentRepository(env: Env): AttachmentRepository {
  return env.NOTES_STORE === "memory"
    ? new InMemoryAttachmentRepository()
    : new DynamoDbAttachmentRepository(documentClient(env), env.TABLE_NAME);
}

export function createPermitLedger(env: Env): PermitLedger {
  return env.NOTES_STORE === "memory"
    ? new InMemoryPermitLedger()
    : new DynamoDbPermitLedger(documentClient(env), env.TABLE_NAME);
}

/** The entry point decides who vouches for the caller and where the bytes go. */
export function composeApp(
  source: Record<string, string | undefined>,
  authenticate: Authenticate,
  objects: ObjectStore,
): App {
  const env = parseEnv(source);
  const log = createLogger(env.LOG_LEVEL);
  const randomSuffix = () => randomBytes(5).toString("hex");
  const notes = createNoteService({
    // As in chapter 06. With ten images a note, it also bounds what one owner can keep in the bucket.
    repository: createRepository(env, MAX_NOTES_PER_OWNER),
    now: () => new Date(),
    randomSuffix,
  });
  return createApp({
    env,
    authenticate,
    log,
    notes,
    attachments: createAttachmentService({
      notes,
      attachments: createAttachmentRepository(env),
      objects,
      permits: createPermitLedger(env),
      now: () => new Date(),
      randomSuffix,
      log,
    }),
    newRequestId: randomUUID,
    now: Date.now,
  });
}
