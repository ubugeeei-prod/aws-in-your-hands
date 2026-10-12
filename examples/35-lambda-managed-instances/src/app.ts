import { randomUUID } from "node:crypto";

import { createApp } from "@aih/example-04-http-api/src/app.ts";
import { type Env, parseEnv } from "@aih/example-04-http-api/src/env.ts";
import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";
import { createLogger, type Logger } from "@aih/example-04-http-api/src/log.ts";
import {
  createNoteService,
  InMemoryNoteRepository,
  type NoteRepository,
} from "@aih/example-04-http-api/src/notes.ts";

import { audited } from "./audit.ts";
import { asyncScope, type RequestScope } from "./scope.ts";

export type ManagedAppDeps = {
  env: Env;
  scope: RequestScope;
  log: Logger;
  repository: NoteRepository;
  newRequestId: () => string;
  newId: () => string;
  now: () => Date;
};

// #region app
/** The chapter 04 app, with every change to a note logged under the request that made it. */
export function createManagedApp(deps: ManagedAppDeps): Fetch {
  const app = createApp({
    env: deps.env,
    log: deps.log,
    notes: createNoteService({
      repository: audited(deps.repository, deps.scope, deps.log),
      now: deps.now,
      newId: deps.newId,
    }),
    // Chapter 04 asks for an ID once, as the request arrives. It gets the one the scope holds.
    newRequestId: () => deps.scope.current()?.requestId ?? deps.newRequestId(),
    now: () => deps.now().getTime(),
  });
  return (request) => deps.scope.run({ requestId: deps.newRequestId() }, () => app(request));
}
// #endregion app

// #region compose
/** The one place that touches the real clock, real randomness, and the real environment. */
export function composeManagedApp(
  source: Record<string, string | undefined>,
  scope: RequestScope = asyncScope,
): Fetch {
  const env = parseEnv(source);
  return createManagedApp({
    env,
    scope,
    log: createLogger(env.LOG_LEVEL),
    // One Map per copy of this module: on Managed Instances, one per worker thread.
    repository: new InMemoryNoteRepository(),
    newRequestId: randomUUID,
    newId: randomUUID,
    now: () => new Date(),
  });
}
// #endregion compose
