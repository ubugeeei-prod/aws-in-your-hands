import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { createApp } from "@aih/example-04-http-api/src/app.ts";
import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";
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

// Chapter 04's Node.js server: a node:http Server that hands each request to the app.
const server = nodeServer(app);
server.listen(env.PORT, env.HOST, () => {
  const { address, port } = server.address() as AddressInfo;
  log({ level: "info", message: "listening", host: address, port, notesFile: env.NOTES_FILE });
});

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
