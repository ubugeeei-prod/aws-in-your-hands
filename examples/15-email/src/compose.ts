import { randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";

import { createApp } from "./app.ts";
import { DynamoDbNotificationStore } from "./dynamodb-store.ts";
import { type Env, parseEnv, parseEventsEnv } from "./env.ts";
import { createEventsHandler } from "./events.ts";
import { createLogger, type Logger } from "./log.ts";
import { type Mailer, OutboxMailer } from "./mailer.ts";
import { MemoryNotificationStore } from "./memory-store.ts";
import { SesMailer } from "./ses-mailer.ts";
import type { NotificationStore } from "./store.ts";

export const createDynamoDbStore = (tableName: string): NotificationStore =>
  new DynamoDbNotificationStore(DynamoDBDocumentClient.from(new DynamoDBClient({})), tableName);

// #region adapters
export function createAdapters(env: Env): {
  store: NotificationStore;
  mailer: Mailer;
  outbox?: OutboxMailer;
} {
  if (env.MAIL_MODE === "local") {
    const outbox = new OutboxMailer();
    return { store: new MemoryNotificationStore(), mailer: outbox, outbox };
  }
  return {
    store: createDynamoDbStore(env.TABLE_NAME),
    // One attempt. The SDK's own retry after a timeout would be a second send that no record knows about.
    mailer: new SesMailer(new SESv2Client({ maxAttempts: 1 }), env.CONFIGURATION_SET_NAME),
  };
}
// #endregion adapters

export type Composed = {
  app: Fetch;
  env: Env;
  store: NotificationStore;
  log: Logger;
  outbox?: OutboxMailer;
};

/** The one place that touches the real clock, real randomness, and the real environment. */
export function composeApp(source: Record<string, string | undefined>): Composed {
  const env = parseEnv(source);
  const log = createLogger(env.LOG_LEVEL);
  const { store, mailer, outbox } = createAdapters(env);
  const app = createApp({
    stage: env.STAGE,
    mode: env.MAIL_MODE,
    log,
    newRequestId: randomUUID,
    now: Date.now,
    notify: {
      store,
      mailer,
      log,
      now: () => new Date(),
      settings: {
        fromAddress: env.FROM_ADDRESS,
        appOrigin: env.APP_ORIGIN,
        retentionDays: env.RETENTION_DAYS,
      },
    },
  });
  return { app, env, store, log, ...(outbox === undefined ? {} : { outbox }) };
}

export function composeEventsHandler(source: Record<string, string | undefined>) {
  const env = parseEventsEnv(source);
  return createEventsHandler({
    store: createDynamoDbStore(env.TABLE_NAME),
    log: createLogger(env.LOG_LEVEL),
  });
}
