import * as v from "valibot";

import { readJson } from "@aih/example-04-http-api/src/http/body.ts";
import { type Fetch, route, router } from "@aih/example-04-http-api/src/http/router.ts";
import type { Logger } from "@aih/example-04-http-api/src/log.ts";

import {
  type ErrorBody,
  type Failure,
  summarizeRequestSchema,
  type SummaryEvent,
} from "./contract.ts";
import type { Env } from "./env.ts";
import { sseFrame } from "./sse.ts";
import type { Summarize } from "./summarize.ts";

export type AppDeps = {
  env: Env;
  summarize: Summarize;
  log: Logger;
  newRequestId: () => string;
  now: () => number;
};

/** What every route sees besides the request. */
type Context = { requestId: string };

const failure = (
  status: number,
  code: ErrorBody["error"]["code"],
  message: string,
  { requestId }: Context,
  extra: { retryable?: boolean; issues?: { path: string; message: string }[] } = {},
) =>
  Response.json({ error: { code, message, requestId, ...extra } } satisfies ErrorBody, { status });

// What a failure looks like when nothing has been streamed yet.
const STATUS = {
  throttled: 429,
  unavailable: 503,
  timeout: 504,
  cancelled: 503,
  interrupted: 502,
  bad_output: 502,
  rejected: 502,
  misconfigured: 500,
  internal: 500,
} as const satisfies Record<Failure["code"], number>;

/** One word for the log: how the stream ended. */
function outcomeOf(last: SummaryEvent | undefined): string {
  if (last?.type === "done") {
    return last.complete ? "complete" : last.stopReason;
  }
  return last?.type === "error" ? last.code : "interrupted";
}

export function createApp(deps: AppDeps): Fetch {
  const routes = router<Context>(
    [
      route("GET", "/health", () =>
        Response.json({
          status: "ok",
          stage: deps.env.STAGE,
          backend: deps.env.AI_BACKEND,
          modelId: deps.env.BEDROCK_MODEL_ID,
        }),
      ),
      route("POST", "/summaries", async (request, context) => {
        const body = await readJson(request, 64 * 1024);
        if (!body.ok) {
          return body.reason === "too_large"
            ? failure(413, "payload_too_large", "The request body exceeds 64 KiB.", context)
            : failure(400, "invalid_request", "The request body is not valid JSON.", context);
        }
        const input = v.safeParse(summarizeRequestSchema, body.value);
        if (!input.success) {
          const issues = input.issues.map((issue) => ({
            path: v.getDotPath(issue) ?? "",
            message: issue.message,
          }));
          return failure(400, "invalid_request", "The note is not valid.", context, { issues });
        }

        // #region route
        const startedAt = deps.now();
        // Aborted when the caller goes away, so the model stops being paid to write for nobody.
        const caller = new AbortController();
        request.signal.addEventListener("abort", () => caller.abort(), { once: true });

        const record = (outcome: string, attempts: number, last?: SummaryEvent) =>
          deps.log({
            level: outcome === "complete" ? "info" : "warn",
            message: "summary",
            requestId: context.requestId,
            modelId: deps.env.BEDROCK_MODEL_ID,
            backend: deps.env.AI_BACKEND,
            outcome,
            attempts,
            // The billed quantities, when the model reported them.
            usage: last?.type === "done" ? last.usage : null,
            durationMs: deps.now() - startedAt,
          });

        const start = await deps.summarize(input.output, caller.signal);
        if (!start.ok) {
          // Nothing was sent yet, so the failure can still be an ordinary HTTP error.
          record(start.failure.code, start.attempts);
          const { code, retryable } = start.failure;
          return failure(STATUS[code], code, "The summary could not be started.", context, {
            retryable,
          });
        }

        // The status and the headers leave now. The body is written afterwards, event by event.
        const encoder = new TextEncoder();
        let reading = true;
        const events = new ReadableStream<Uint8Array>({
          start(controller) {
            void (async () => {
              let last: SummaryEvent | undefined;
              for await (const event of start.events) {
                last = event;
                if (reading) {
                  controller.enqueue(encoder.encode(sseFrame(event.type, JSON.stringify(event))));
                }
              }
              if (reading) {
                controller.close();
              }
              record(outcomeOf(last), start.attempts, last);
            })();
          },
          // Whoever was reading the body has stopped. The relay ends itself once the model call is aborted.
          cancel() {
            reading = false;
            caller.abort();
          },
        });
        return new Response(events, {
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        });
        // #endregion route
      }),
    ],
    (_request, context) => failure(404, "not_found", "No such route.", context),
  );

  return async (request) => {
    const context = { requestId: deps.newRequestId() };
    let response: Response;
    try {
      response = await routes(request, context);
    } catch (error) {
      deps.log({
        level: "error",
        message: "unhandled error",
        requestId: context.requestId,
        error: error instanceof Error ? error.stack : String(error),
      });
      response = failure(500, "internal", "The request could not be completed.", context);
    }
    response.headers.set("x-request-id", context.requestId);
    return response;
  };
}
