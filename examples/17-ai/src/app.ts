import type { Logger } from "@aih/example-04-http-api/src/log.ts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { validator } from "hono/validator";
import { type ErrorBody, type Failure, summarizeRequestSchema, type SummaryEvent } from "./contract.ts";
import type { Env } from "./env.ts";
import type { Summarize } from "./summarize.ts";

export type AppDeps = {
  env: Env;
  summarize: Summarize;
  log: Logger;
  newRequestId: () => string;
  now: () => number;
};

type Variables = { requestId: string };

const failure = (
  code: ErrorBody["error"]["code"],
  message: string,
  requestId: string,
  extra: { retryable?: boolean; issues?: { path: string; message: string }[] } = {},
) => ({ error: { code, message, requestId, ...extra } }) satisfies ErrorBody;

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

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: Variables }>();

  app.use(async (c, next) => {
    const requestId = deps.newRequestId();
    c.set("requestId", requestId);
    await next();
    c.header("x-request-id", requestId);
  });

  app.onError((error, c) => {
    const requestId = c.get("requestId");
    if (error instanceof HTTPException && error.status === 400) {
      return c.json(failure("invalid_request", "The request body is not valid JSON.", requestId), 400);
    }
    deps.log({
      level: "error",
      message: "unhandled error",
      requestId,
      error: error instanceof Error ? error.stack : String(error),
    });
    return c.json(failure("internal", "The request could not be completed.", requestId), 500);
  });

  app.notFound((c) => c.json(failure("not_found", "No such route.", c.get("requestId")), 404));

  return app
    .get("/health", (c) =>
      c.json({
        status: "ok" as const,
        stage: deps.env.STAGE,
        backend: deps.env.AI_BACKEND,
        modelId: deps.env.BEDROCK_MODEL_ID,
      }),
    )
    .post(
      "/summaries",
      bodyLimit({
        maxSize: 64 * 1024,
        onError: (c) =>
          c.json(failure("payload_too_large", "The request body exceeds 64 KiB.", c.get("requestId")), 413),
      }),
      validator("json", (value, c) => {
        const input = summarizeRequestSchema.safeParse(value);
        if (!input.success) {
          const issues = input.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
          return c.json(failure("invalid_request", "The note is not valid.", c.get("requestId"), { issues }), 400);
        }
        return input.data;
      }),
      // #region route
      async (c) => {
        const requestId = c.get("requestId");
        const startedAt = deps.now();
        // Aborted when the caller goes away, so the model stops being paid to write for nobody.
        const caller = new AbortController();
        c.req.raw.signal.addEventListener("abort", () => caller.abort(), { once: true });

        const record = (outcome: string, attempts: number, last?: SummaryEvent) =>
          deps.log({
            level: outcome === "complete" ? "info" : "warn",
            message: "summary",
            requestId,
            modelId: deps.env.BEDROCK_MODEL_ID,
            backend: deps.env.AI_BACKEND,
            outcome,
            attempts,
            // The billed quantities, when the model reported them.
            usage: last?.type === "done" ? last.usage : null,
            durationMs: deps.now() - startedAt,
          });

        const start = await deps.summarize(c.req.valid("json"), caller.signal);
        if (!start.ok) {
          // Nothing was sent yet, so the failure can still be an ordinary HTTP error.
          record(start.failure.code, start.attempts);
          const { code, retryable } = start.failure;
          return c.json(failure(code, "The summary could not be started.", requestId, { retryable }), STATUS[code]);
        }

        return streamSSE(c, async (stream) => {
          stream.onAbort(() => caller.abort());
          let last: SummaryEvent | undefined;
          for await (const event of start.events) {
            last = event;
            await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
          }
          record(outcomeOf(last), start.attempts, last);
        });
      },
      // #endregion route
    );
}

export type App = ReturnType<typeof createApp>;
