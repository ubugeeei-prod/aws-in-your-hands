import { randomBytes, randomUUID } from "node:crypto";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { z } from "zod";

import { parseEnv } from "@aih/example-05-dynamodb/src/env.ts";
import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";
import { signLocalToken } from "@aih/example-06-auth/api/src/local-auth.ts";
import { MAX_UPLOAD_BYTES } from "@aih/example-07-uploads/api/src/contract.ts";
import { parseUploadsEnv } from "@aih/example-07-uploads/api/src/env.ts";
import {
  createLocalStoreHandler,
  LOCAL_STORE_PATH,
} from "@aih/example-07-uploads/api/src/local-store-http.ts";

import { parseLocalQueueEnv } from "./env.ts";
import { createLocal } from "./local.ts";

const secret = z
  .string()
  .min(32, "LOCAL_AUTH_SECRET must be set (see .env.example)")
  .parse(process.env["LOCAL_AUTH_SECRET"]);
const env = parseEnv(process.env);
const port = Number(process.env["PORT"] ?? 8787);
if (env.NOTES_STORE !== "memory" || parseUploadsEnv(process.env).UPLOADS_STORE !== "memory") {
  throw new Error(
    "The development server keeps everything in memory. Set NOTES_STORE=memory and UPLOADS_STORE=memory.",
  );
}
const queueEnv = parseLocalQueueEnv(process.env);
const log = createLogger(env.LOG_LEVEL);

// #region dev
const local = createLocal({
  env,
  secret,
  baseUrl: `http://localhost:${port}`,
  now: () => new Date(),
  randomSuffix: () => randomBytes(5).toString("hex"),
  newId: randomUUID,
  log,
  queue: {
    visibilityTimeoutMs: queueEnv.LOCAL_QUEUE_VISIBILITY_SECONDS * 1000,
    maxReceiveCount: queueEnv.LOCAL_QUEUE_MAX_RECEIVE_COUNT,
    duplicate: queueEnv.LOCAL_QUEUE_DUPLICATE === "true",
  },
});

// Stands in for the event source mapping: twice a second, one batch.
setInterval(() => {
  local
    .deliver()
    .catch((error: unknown) =>
      log({ level: "error", message: "batch failed", error: String(error) }),
    );
}, 500);

const server = new Hono();
// What the AWS console and CLI would show: queue depth, the dead-letter queue, the records.
server.get("/local/queue", (c) =>
  c.json({
    ...local.queue.stats(),
    deadLetters: local.queue.dead(),
    inspections: local.inspections.all(),
  }),
);
server.post("/local/queue/redrive", (c) => c.json({ moved: local.queue.redrive() }));
// What the schedule would start. Nothing younger than an hour is touched.
server.post("/local/housekeeping", async (c) =>
  c.json(await local.housekeep({ dryRun: c.req.query("delete") !== "true" })),
);
// #endregion dev

// From here on it is chapter 07's development server: the form's destination,
// the view URLs, and the local sign-in of chapter 06.
const store = createLocalStoreHandler(local.bucket);
server.use(
  "/local/*",
  cors({ origin: env.ALLOWED_ORIGIN, allowMethods: ["POST"], allowHeaders: ["content-type"] }),
);
server.post(LOCAL_STORE_PATH, bodyLimit({ maxSize: MAX_UPLOAD_BYTES + 64 * 1024 }), (c) =>
  store(c.req.raw),
);
server.get(`${LOCAL_STORE_PATH}/*`, (c) => store(c.req.raw));
server.post("/local/token", async (c) => {
  const body = z
    .object({ user: z.string().regex(/^[a-z0-9-]{1,32}$/) })
    .safeParse(await c.req.json().catch(() => undefined));
  if (!body.success) {
    return c.json({ error: "user must be 1-32 characters of a-z, 0-9, or -" }, 400);
  }
  return c.json({
    accessToken: await signLocalToken(secret, `local-${body.data.user}`),
    sub: `local-${body.data.user}`,
  });
});
server.route("/", local.app);

serve({ fetch: server.fetch, port }, (info) => {
  console.log(
    `notes API on http://localhost:${info.port}: in-memory uploads, queue (visibility ` +
      `${queueEnv.LOCAL_QUEUE_VISIBILITY_SECONDS}s, ${queueEnv.LOCAL_QUEUE_MAX_RECEIVE_COUNT} receives), and worker`,
  );
});
