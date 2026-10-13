import { randomUUID } from "node:crypto";

import * as v from "valibot";

import { createApp } from "@aih/example-04-http-api/src/app.ts";
import { type Env, parseEnv } from "@aih/example-04-http-api/src/env.ts";
import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";
import { createLogger, type Logger } from "@aih/example-04-http-api/src/log.ts";
import {
  createNoteService,
  InMemoryNoteRepository,
  type NoteRepository,
} from "@aih/example-04-http-api/src/notes.ts";
import { audited } from "@aih/example-35-lambda-managed-instances/src/audit.ts";
import {
  asyncScope,
  type RequestScope,
} from "@aih/example-35-lambda-managed-instances/src/scope.ts";

import { objectLogger } from "./log.ts";

// #region headers
/** Set by Lambda on every request it forwards. A caller's own `lambda-web-*` headers are removed first. */
export const REQUEST_ID_HEADER = "lambda-web-request-id";
/** Which upload of the code answered. Web Function metrics have no dimension for the revision. */
export const RELEASE_HEADER = "x-aih-release";

// The ID goes back out in a response header and into log lines, so only a plain token is taken as it is.
const requestIdSchema = v.pipe(v.string(), v.regex(/^[\w-]{1,128}$/));
// #endregion headers

export type WebAppDeps = {
  env: Env;
  /** The S3 object version the revision was made from. "local" on a laptop. */
  release: string;
  scope: RequestScope;
  log: Logger;
  repository: NoteRepository;
  newRequestId: () => string;
  newId: () => string;
  now: () => Date;
};

// #region half-duplex
/**
 * Lambda hands over the whole request body before it delivers the answer. Chapter 04 answers
 * 413 from the content-length header without reading a byte, so what is left is read here.
 */
async function readToEnd(request: Request): Promise<void> {
  if (request.body === null || request.bodyUsed) {
    return;
  }
  const reader = request.body.getReader();
  try {
    while (!(await reader.read()).done) {
      // Discarded. Only the end matters.
    }
  } catch {
    // The caller went away. There is nobody left to answer.
  }
}
// #endregion half-duplex

// #region app
/** The chapter 04 app under the request ID Lambda assigned, safe for many requests at once. */
export function createWebApp(deps: WebAppDeps): Fetch {
  const app = createApp({
    env: deps.env,
    log: deps.log,
    notes: createNoteService({
      // Chapter 35's wrapper: one log line per change, read from the scope after an await.
      repository: audited(deps.repository, deps.scope, deps.log),
      now: deps.now,
      newId: deps.newId,
    }),
    newRequestId: () => deps.scope.current()?.requestId ?? deps.newRequestId(),
    now: () => deps.now().getTime(),
  });
  return async (request) => {
    const given = v.safeParse(requestIdSchema, request.headers.get(REQUEST_ID_HEADER));
    const requestId = given.success ? given.output : deps.newRequestId();
    const response = await deps.scope.run({ requestId }, () => app(request));
    await readToEnd(request);
    response.headers.set(RELEASE_HEADER, deps.release);
    return response;
  };
}
// #endregion app

const releaseSchema = v.optional(v.pipe(v.string(), v.regex(/^\S{1,1024}$/)), "local");

// #region compose
/** The one place that touches the real clock, real randomness, and the real environment. */
export function composeWebApp(
  source: Record<string, string | undefined>,
  scope: RequestScope = asyncScope,
): Fetch {
  const env = parseEnv(source);
  const release = v.parse(releaseSchema, source["RELEASE"]);
  // Set in every execution environment. Set by hand on a laptop, it selects the same logger.
  const onLambda = source["AWS_LAMBDA_HTTP_ENDPOINT"] !== undefined;
  return createWebApp({
    env,
    release,
    scope,
    log: onLambda ? objectLogger(env.LOG_LEVEL, { release }) : createLogger(env.LOG_LEVEL),
    // One Map per execution environment, as in chapter 04. Chapter 05 replaces it with a table.
    repository: new InMemoryNoteRepository(),
    newRequestId: randomUUID,
    newId: randomUUID,
    now: () => new Date(),
  });
}
// #endregion compose
