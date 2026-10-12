import { randomUUID } from "node:crypto";

import { createApp } from "@aih/example-04-http-api/src/app.ts";
import { createLogger, type Logger } from "@aih/example-04-http-api/src/log.ts";
import {
  createNoteService,
  InMemoryNoteRepository,
  type NoteRepository,
} from "@aih/example-04-http-api/src/notes.ts";

import { parseServerEnv, type ServerEnv } from "./env.ts";

export type Fetch = (request: Request) => Response | Promise<Response>;

// #region wrap
/** The load balancer asks /health every few seconds, from every zone. Only failures are worth a line. */
export const quietHealth =
  (log: Logger): Logger =>
  (entry) => {
    if (entry.message === "request" && entry["path"] === "/health" && entry["status"] === 200) {
      return;
    }
    log(entry);
  };

/** Says which build answered. During a rollout, two of them do. */
export const withVersion =
  (fetch: Fetch, version: string): Fetch =>
  async (request) => {
    const response = await fetch(request);
    response.headers.set("x-app-version", version);
    return response;
  };
// #endregion wrap

// #region compose
export type Composed = { fetch: Fetch; env: ServerEnv; log: Logger };

/** Chapter 04's app, unchanged, with the two things a long-running task adds around it. */
export function composeServer(
  source: Record<string, string | undefined>,
  repository: NoteRepository = new InMemoryNoteRepository(),
): Composed {
  const env = parseServerEnv(source);
  const log = createLogger(env.LOG_LEVEL);
  const app = createApp({
    env,
    log: quietHealth(log),
    notes: createNoteService({ repository, now: () => new Date(), newId: randomUUID }),
    newRequestId: randomUUID,
    now: Date.now,
  });
  return { fetch: withVersion((request) => app.fetch(request), env.APP_VERSION), env, log };
}
// #endregion compose
