import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";
import { createLogger } from "@aih/example-13-sql/src/log.ts";

import { createRoutedApp } from "./app.ts";
import { parseEnv } from "./env.ts";
import { postgresPosition } from "./position.ts";
import { iamToken, openRds } from "./rds.ts";
import { API_ROLE } from "./roles.ts";

// #region handler
const env = parseEnv(process.env);
const log = createLogger(env.LOG_LEVEL);

// Once per execution environment. The first query opens the connection, and
// later invocations in this environment reuse it.
const open = (host: string) =>
  openRds({
    host,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: API_ROLE,
    password: iamToken({ host, port: env.DB_PORT, user: API_ROLE, region: env.AWS_REGION }),
    onPoolError: (error) =>
      log({ level: "warn", message: "idle connection lost", host, error: error.message }),
  });

const primary = open(env.DB_HOST);
const replica = env.DB_REPLICA_HOST === "" ? undefined : open(env.DB_REPLICA_HOST);

export const handler = handleApiGateway(
  createRoutedApp({
    allowedOrigin: env.ALLOWED_ORIGIN,
    stage: env.STAGE,
    database: "rds",
    primary,
    ...(replica === undefined
      ? {}
      : { replica: { db: replica, position: postgresPosition(primary, replica) } }),
    log,
    clock: () => new Date(),
    now: Date.now,
    newId: randomUUID,
    newRequestId: randomUUID,
    sleep: (ms) => sleep(ms),
    random: Math.random,
  }),
);
// #endregion handler
