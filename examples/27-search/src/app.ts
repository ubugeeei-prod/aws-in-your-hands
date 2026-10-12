import * as v from "valibot";

import { readJson } from "@aih/example-04-http-api/src/http/body.ts";
import { type Fetch, route, router } from "@aih/example-04-http-api/src/http/router.ts";
import type { Logger } from "@aih/example-04-http-api/src/log.ts";
import type { Failure } from "@aih/example-17-ai/src/contract.ts";
import { sseFrame } from "@aih/example-17-ai/src/sse.ts";

import type { Answer } from "./answer.ts";
import {
  type AnswerEvent,
  answerRequestSchema,
  type ErrorBody,
  type Hit,
  searchRequestSchema,
  type SearchResponse,
} from "./contract.ts";
import type { FoundPassage, Search } from "./search.ts";

export type AppDeps = {
  stage: string;
  backend: "local" | "aws";
  /** Who is asking. Undefined means nobody the app can name, and the request is refused. */
  ownerOf: (request: Request) => string | undefined;
  search: Search;
  answer: Answer;
  log: Logger;
  newRequestId: () => string;
  now: () => number;
};

type Context = { requestId: string };

const failure = (
  status: number,
  code: ErrorBody["error"]["code"],
  message: string,
  { requestId }: Context,
  extra: { retryable?: boolean; issues?: { path: string; message: string }[] } = {},
) =>
  Response.json({ error: { code, message, requestId, ...extra } } satisfies ErrorBody, { status });

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

const MAX_BODY_BYTES = 16 * 1024;
const SNIPPET_CHARS = 160;

// #region hits
/** One hit per note: its best passage, and every way any of its passages matched. */
export function toHits(passages: FoundPassage[], limit: number): Hit[] {
  const hits = new Map<string, Hit>();
  for (const passage of passages) {
    const existing = hits.get(passage.noteId);
    if (existing !== undefined) {
      existing.matched = [...new Set([...existing.matched, ...passage.matched])].toSorted();
      continue;
    }
    hits.set(passage.noteId, {
      noteId: passage.noteId,
      title: passage.title,
      // A passage starts with the title. The snippet is what follows it.
      snippet: Array.from(passage.text.slice(passage.title.length).trim())
        .slice(0, SNIPPET_CHARS)
        .join(""),
      score: passage.score,
      matched: passage.matched.toSorted(),
    });
  }
  return [...hits.values()].slice(0, limit);
}
// #endregion hits

export function createApp(deps: AppDeps): Fetch {
  /** Reads and checks a JSON body, or answers why it could not. */
  const read = async <Schema extends v.GenericSchema>(
    request: Request,
    schema: Schema,
    context: Context,
  ): Promise<{ ok: true; value: v.InferOutput<Schema> } | { ok: false; response: Response }> => {
    const body = await readJson(request, MAX_BODY_BYTES);
    if (!body.ok) {
      return {
        ok: false,
        response:
          body.reason === "too_large"
            ? failure(413, "payload_too_large", "The request body exceeds 16 KiB.", context)
            : failure(400, "invalid_request", "The request body is not valid JSON.", context),
      };
    }
    const input = v.safeParse(schema, body.value);
    if (!input.success) {
      const issues = input.issues.map((issue) => ({
        path: v.getDotPath(issue) ?? "",
        message: issue.message,
      }));
      return {
        ok: false,
        response: failure(400, "invalid_request", "The request is not valid.", context, { issues }),
      };
    }
    return { ok: true, value: input.output };
  };

  const unauthenticated = (context: Context) =>
    failure(401, "unauthenticated", "The request does not say whose notes to search.", context);

  const routes = router<Context>(
    [
      route("GET", "/health", () =>
        Response.json({ status: "ok", stage: deps.stage, backend: deps.backend }),
      ),
      // #region search-route
      route("POST", "/search", async (request, context) => {
        // The owner comes from who is calling, never from the body: a body is whatever the caller typed.
        const owner = deps.ownerOf(request);
        if (owner === undefined) {
          return unauthenticated(context);
        }
        const input = await read(request, searchRequestSchema, context);
        if (!input.ok) {
          return input.response;
        }
        const startedAt = deps.now();
        // More passages than hits are asked for, because several can belong to one note.
        const found = await deps.search(owner, input.value.query, input.value.limit * 4);
        const hits = toHits(found.passages, input.value.limit);
        deps.log({
          level: found.meaning === "used" ? "info" : "warn",
          message: "search",
          requestId: context.requestId,
          hits: hits.length,
          meaning: found.meaning,
          // Above zero means the index and the table disagree. The answer is still right.
          dropped: found.dropped,
          durationMs: deps.now() - startedAt,
        });
        return Response.json({ hits, meaning: found.meaning } satisfies SearchResponse);
      }),
      // #endregion search-route
      // #region answer-route
      route("POST", "/answers", async (request, context) => {
        const owner = deps.ownerOf(request);
        if (owner === undefined) {
          return unauthenticated(context);
        }
        const input = await read(request, answerRequestSchema, context);
        if (!input.ok) {
          return input.response;
        }
        const startedAt = deps.now();
        const caller = new AbortController();
        request.signal.addEventListener("abort", () => caller.abort(), { once: true });

        const record = (outcome: string, attempts: number, last?: AnswerEvent) =>
          deps.log({
            level: outcome === "complete" || outcome === "no_sources" ? "info" : "warn",
            message: "answer",
            requestId: context.requestId,
            outcome,
            attempts,
            usage: last?.type === "done" ? last.usage : null,
            citations: last?.type === "done" ? last.citations : null,
            unknownCitations: last?.type === "done" ? last.unknownCitations : null,
            durationMs: deps.now() - startedAt,
          });

        const start = await deps.answer(owner, input.value.question, caller.signal);
        if (!start.ok) {
          record(start.failure.code, start.attempts);
          const { code, retryable } = start.failure;
          return failure(STATUS[code], code, "The answer could not be started.", context, {
            retryable,
          });
        }

        const encoder = new TextEncoder();
        let reading = true;
        const events = new ReadableStream<Uint8Array>({
          start(controller) {
            void (async () => {
              let last: AnswerEvent | undefined;
              for await (const event of start.events) {
                last = event;
                if (reading) {
                  controller.enqueue(encoder.encode(sseFrame(event.type, JSON.stringify(event))));
                }
              }
              if (reading) {
                controller.close();
              }
              const outcome =
                last?.type === "done"
                  ? last.complete
                    ? "complete"
                    : last.stopReason
                  : last?.type === "error"
                    ? last.code
                    : "interrupted";
              record(outcome, start.attempts, last);
            })();
          },
          cancel() {
            reading = false;
            caller.abort();
          },
        });
        return new Response(events, {
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        });
      }),
      // #endregion answer-route
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
