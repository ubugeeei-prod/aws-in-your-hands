import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";
import { createLogger } from "@aih/example-13-sql/src/log.ts";
import { migrate } from "@aih/example-13-sql/src/migrate.ts";

import { createRoutedApp } from "./app.ts";
import { chapter13Migrations } from "./migrations.ts";
import { createReplicationModel } from "./model/replication.ts";

// #region dev
// The model of a primary and a replica, in memory: it starts empty every time,
// so it migrates itself. The replica hears of each commit this much later.
const lagMs = Number(process.env["REPLICA_LAG_MS"] ?? 5000);
const model = await createReplicationModel({
  onCommit: () => void sleep(lagMs).then(() => model.replay(1)),
});
await model.primary.withConnection((connection) =>
  migrate(connection, chapter13Migrations(), {
    dialect: "postgres",
    now: () => new Date(),
    sleep: (ms) => sleep(ms),
    log: () => undefined,
  }),
);

const port = Number(process.env["PORT"] ?? 8787);
nodeServer(
  createRoutedApp({
    allowedOrigin: process.env["ALLOWED_ORIGIN"] ?? "http://localhost:5173",
    stage: "local",
    database: "model",
    primary: model.primary,
    replica: { db: model.replica, position: model.position },
    log: createLogger("info"),
    clock: () => new Date(),
    now: Date.now,
    newId: randomUUID,
    newRequestId: randomUUID,
    sleep: (ms) => sleep(ms),
    random: Math.random,
  }),
).listen(port, () => {
  console.log(`notes API on http://localhost:${port} (a model replica, ${lagMs} ms behind)`);
});
// #endregion dev
