import { randomBytes, randomUUID } from "node:crypto";
import { createRepository } from "@aih/example-05-dynamodb/src/compose.ts";
import { type Env, parseEnv } from "@aih/example-05-dynamodb/src/env.ts";
import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";
import { createNoteService } from "@aih/example-05-dynamodb/src/notes.ts";
import type { Authenticate } from "@aih/example-06-auth/api/src/identity.ts";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { type App, createApp } from "./app.ts";
import { type AttachmentRepository, InMemoryAttachmentRepository } from "./attachment-repository.ts";
import { createAttachmentService } from "./attachments.ts";
import { DynamoDbAttachmentRepository } from "./dynamodb-attachment-repository.ts";
import type { ObjectStore } from "./object-store.ts";

export function createAttachmentRepository(env: Env): AttachmentRepository {
  if (env.NOTES_STORE === "memory") {
    return new InMemoryAttachmentRepository();
  }
  // The same table as the notes, reached the same way as in chapter 05.
  const client = new DynamoDBClient(
    env.DYNAMODB_ENDPOINT === undefined
      ? {}
      : {
          endpoint: env.DYNAMODB_ENDPOINT,
          region: "ap-northeast-1",
          credentials: { accessKeyId: "local", secretAccessKey: "local" },
        },
  );
  return new DynamoDbAttachmentRepository(DynamoDBDocumentClient.from(client), env.TABLE_NAME);
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
  const notes = createNoteService({ repository: createRepository(env), now: () => new Date(), randomSuffix });
  return createApp({
    env,
    authenticate,
    log,
    notes,
    attachments: createAttachmentService({
      notes,
      attachments: createAttachmentRepository(env),
      objects,
      now: () => new Date(),
      randomSuffix,
      log,
    }),
    newRequestId: randomUUID,
    now: Date.now,
  });
}
