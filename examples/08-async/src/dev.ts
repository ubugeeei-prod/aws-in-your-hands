import { randomBytes, randomUUID } from "node:crypto";

import * as v from "valibot";

import { readJson } from "@aih/example-04-http-api/src/http/body.ts";
import { cors } from "@aih/example-04-http-api/src/http/cors.ts";
import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";
import { route, router } from "@aih/example-04-http-api/src/http/router.ts";
import { parseEnv } from "@aih/example-05-dynamodb/src/env.ts";
import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";
import { signLocalToken } from "@aih/example-06-auth/api/src/local-auth.ts";
import { parseUploadsEnv } from "@aih/example-07-uploads/api/src/env.ts";
import { createLocalStoreHandler } from "@aih/example-07-uploads/api/src/local-store-http.ts";

import { parseLocalQueueEnv } from "./env.ts";
import { createLocal } from "./local.ts";

const secretMessage = "LOCAL_AUTH_SECRET must be set (see .env.example)";
const secret = v.parse(
  v.pipe(v.string(secretMessage), v.minLength(32, secretMessage)),
  process.env["LOCAL_AUTH_SECRET"],
);
const env = parseEnv(process.env);
const port = Number(process.env["PORT"] ?? 8787);
if (env.NOTES_STORE !== "memory" || parseUploadsEnv(process.env).UPLOADS_STORE !== "memory") {
  throw new Error(
    "The development server keeps everything in memory. Set NOTES_STORE=memory and UPLOADS_STORE=memory.",
  );
}
const queueEnv = parseLocalQueueEnv(process.env);
const log = createLogger(env.LOG_LEVEL);

const userSchema = v.object({ user: v.pipe(v.string(), v.regex(/^[a-z0-9-]{1,32}$/)) });

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

// What the AWS console and CLI would show: queue depth, the dead-letter queue, the records.
// A terminal asks for these, not a page, so they sit outside the CORS headers.
const operations = router<undefined>(
  [
    route("GET", "/local/queue", () =>
      Response.json({
        ...local.queue.stats(),
        deadLetters: local.queue.dead(),
        inspections: local.inspections.all(),
      }),
    ),
    route("POST", "/local/queue/redrive", () => Response.json({ moved: local.queue.redrive() })),
    // What the schedule would start. Nothing younger than an hour is touched.
    route("POST", "/local/housekeeping", async (request) =>
      Response.json(
        await local.housekeep({
          dryRun: new URL(request.url).searchParams.get("delete") !== "true",
        }),
      ),
    ),
  ],
  // Any other path under /local/ is chapter 07's, below.
  (request) => uploads(request, undefined),
);
// #endregion dev

// From here on it is chapter 07's development server: the sign-in of chapter 06,
// and, for any other path under /local/, the stand-in for the bucket.
const store = createLocalStoreHandler(local.bucket);
const uploads = cors(
  { origin: env.ALLOWED_ORIGIN, allowMethods: ["POST"], allowHeaders: ["content-type"] },
  router<undefined>(
    [
      route("POST", "/local/token", async (request) => {
        const json = await readJson(request, 1024);
        const body = v.safeParse(userSchema, json.ok ? json.value : undefined);
        if (!body.success) {
          return Response.json(
            { error: "user must be 1-32 characters of a-z, 0-9, or -" },
            { status: 400 },
          );
        }
        const sub = `local-${body.output.user}`;
        return Response.json({ accessToken: await signLocalToken(secret, sub), sub });
      }),
    ],
    (request) => store(request),
  ),
);

nodeServer((request) =>
  new URL(request.url).pathname.startsWith("/local/")
    ? operations(request, undefined)
    : local.app(request),
).listen(port, () => {
  console.log(
    `notes API on http://localhost:${port}: in-memory uploads, queue (visibility ` +
      `${queueEnv.LOCAL_QUEUE_VISIBILITY_SECONDS}s, ${queueEnv.LOCAL_QUEUE_MAX_RECEIVE_COUNT} receives), and worker`,
  );
});
