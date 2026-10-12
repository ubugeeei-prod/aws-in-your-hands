import { randomUUID } from "node:crypto";
import { Server } from "node:http";
import { resolve } from "node:path";

import { serve } from "@hono/node-server";

import { createApp } from "@aih/example-04-http-api/src/app.ts";
import { createLogger } from "@aih/example-04-http-api/src/log.ts";
import { createNoteService } from "@aih/example-04-http-api/src/notes.ts";

import { parseServerEnv } from "./env.ts";
import { FileNoteRepository } from "./file-notes.ts";
import { SHUTDOWN_GRACE_MS } from "./machine.ts";
import { nodeFiles } from "./node-files.ts";
import { createShutdown } from "./shutdown.ts";

// #region server
// The chapter 04 app, unchanged. What differs is around it: a file instead of
// a Map, a process that stays up, and a signal handler.
const env = parseServerEnv(process.env);
const log = createLogger(env.LOG_LEVEL);
const repository = await FileNoteRepository.open(nodeFiles, resolve(env.NOTES_FILE));

const app = createApp({
  env,
  log,
  notes: createNoteService({ repository, now: () => new Date(), newId: randomUUID }),
  newRequestId: randomUUID,
  now: Date.now,
});

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  log({
    level: "info",
    message: "listening",
    host: info.address,
    port: info.port,
    notesFile: env.NOTES_FILE,
  });
});

if (!(server instanceof Server)) {
  // serve() can also return an HTTP/2 server, which has no closeAllConnections().
  throw new Error("expected an HTTP/1.1 server");
}

const shutdown = createShutdown({
  server,
  flush: () => repository.idle(),
  graceMs: SHUTDOWN_GRACE_MS,
  log: (message) => log({ level: "info", message }),
  exit: (code) => process.exit(code),
});
// systemd sends SIGTERM on stop and restart. Ctrl+C in a terminal sends SIGINT.
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
// #endregion server
