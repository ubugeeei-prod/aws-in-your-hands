import { context, SpanKind, SpanStatusCode } from "@opentelemetry/api";

import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";
import { createApp } from "@aih/example-05-dynamodb/src/app.ts";
import type { Env } from "@aih/example-05-dynamodb/src/env.ts";
import type { Logger } from "@aih/example-05-dynamodb/src/log.ts";
import { createNoteService } from "@aih/example-05-dynamodb/src/notes.ts";
import type { NoteRepository } from "@aih/example-05-dynamodb/src/repository.ts";

import { contextFromHeaders, hasActiveSpan, withSpan, withTraceFields } from "./telemetry.ts";
import { traceRepository } from "./traced-repository.ts";

export type ObservedDeps = {
  env: Env;
  repository: NoteRepository;
  log: Logger;
  newRequestId: () => string;
  now: () => number;
  randomSuffix: () => string;
};

// #region app
// The chapter 05 app, unchanged, with three things around it: a span per
// request, a span per call to the table, and trace IDs on every log line.
export function createObservedApp(deps: ObservedDeps): Fetch {
  const notes = createApp({
    env: deps.env,
    notes: createNoteService({
      repository: traceRepository(deps.repository),
      now: () => new Date(deps.now()),
      randomSuffix: deps.randomSuffix,
    }),
    log: withTraceFields(deps.log),
    newRequestId: deps.newRequestId,
    now: deps.now,
  });

  // An app is a function, so wrapping one is writing another function around it.
  return (request) => {
    // In Lambda a layer has already opened a span for the invocation; this one
    // goes under it. Otherwise the caller's `traceparent` header decides.
    const underPlatformSpan = hasActiveSpan();
    const parent = underPlatformSpan
      ? context.active()
      : contextFromHeaders(Object.fromEntries(request.headers));

    return withSpan(
      // Low cardinality on purpose: the path with its note ID is an attribute.
      request.method,
      {
        kind: underPlatformSpan ? SpanKind.INTERNAL : SpanKind.SERVER,
        parent,
        // The path without the query string. Query strings carry tokens.
        attributes: {
          "http.request.method": request.method,
          "url.path": new URL(request.url).pathname,
        },
      },
      async (span) => {
        const response = await notes(request);
        span.setAttribute("http.response.status_code", response.status);
        const requestId = response.headers.get("x-request-id");
        if (requestId !== null) {
          // The way back from a trace to the log lines of this request.
          span.setAttribute("app.request_id", requestId);
        }
        if (response.status >= 500) {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        return response;
      },
    );
  };
}
// #endregion app
