import * as v from "valibot";

import { readJson } from "@aih/example-04-http-api/src/http/body.ts";
import { route, router } from "@aih/example-04-http-api/src/http/router.ts";
import type { Logger } from "@aih/example-04-http-api/src/log.ts";
import type { Authenticate, Identity } from "@aih/example-06-auth/api/src/identity.ts";
import type { Failure } from "@aih/example-17-ai/src/contract.ts";
import { sseFrame } from "@aih/example-17-ai/src/sse.ts";

import { type UsageLedger, utcDay } from "./budget.ts";
import { askRequestSchema, type AssistantEvent, type ErrorBody } from "./contract.ts";
import type { Env } from "./env.ts";
import type { InferenceLine } from "./log-shape.ts";
import type { Assistant } from "./loop.ts";
import type { ModelProfile } from "./models.ts";
import type { ExtractActionItems } from "./structured.ts";
import { createNoteTools, type NoteReader } from "./tools.ts";
import { ceilingMicroUsd, costMicroUsd, NO_USAGE, type Usage } from "./usage.ts";

export type AppDeps = {
  env: Env;
  /** Who is calling. Each entry point supplies its own: chapter 06's interface. */
  authenticate: Authenticate;
  notes: NoteReader;
  ledger: UsageLedger;
  assistant: Assistant;
  extract: ExtractActionItems;
  prices: ModelProfile["usdPerMillionTokens"];
  log: Logger;
  newRequestId: () => string;
  now: () => number;
};

/** What an entry point knows besides the request. On Lambda that is the event. */
export type Outside = { event?: unknown };
export type App = (request: Request, outside?: Outside) => Promise<Response>;

type Context = { requestId: string };
type SignedIn = Context & { identity: Identity };

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

const MAX_BODY_BYTES = 16 * 1024;

export function createApp(deps: AppDeps): App {
  const { env, ledger, prices } = deps;
  // More than any request of this app can cost, because the loop stops at this many tokens.
  const reservation = ceilingMicroUsd(env.MAX_TOTAL_TOKENS, prices);

  // #region budget
  /** Sets the request's worst case aside before the model is called. Null when the day's budget cannot take it. */
  async function open(owner: string) {
    const day = utcDay(deps.now());
    if (!(await ledger.reserve(owner, day, reservation, env.DAILY_BUDGET_MICRO_USD))) {
      return null;
    }
    // Replaces the worst case with what the model reported. If this never runs, the
    // worst case stays counted: the budget errs towards refusing.
    return (usage: Usage) => ledger.settle(owner, day, reservation, costMicroUsd(usage, prices));
  }
  // #endregion budget

  const record = (
    message: InferenceLine["message"],
    context: SignedIn,
    startedAt: number,
    result: { outcome: string; turns: number; toolCalls: number; toolErrors: number; usage: Usage },
  ) =>
    deps.log({
      level: result.outcome === "complete" ? "info" : "warn",
      message,
      requestId: context.requestId,
      owner: context.identity.sub,
      modelId: env.BEDROCK_MODEL_ID,
      backend: env.AI_BACKEND,
      ...result,
      costMicroUsd: costMicroUsd(result.usage, prices),
      durationMs: deps.now() - startedAt,
    } satisfies InferenceLine);

  const overBudget = (context: Context) =>
    failure(429, "budget_exceeded", "Today's budget for this account is used up.", context, {
      retryable: false,
    });

  const signedIn = router<SignedIn>(
    [
      route("GET", "/me", (_request, { identity }) => Response.json({ sub: identity.sub })),
      route("POST", "/assistant", async (request, context) => {
        const body = await readJson(request, MAX_BODY_BYTES);
        if (!body.ok) {
          return body.reason === "too_large"
            ? failure(413, "payload_too_large", "The request body exceeds 16 KiB.", context)
            : failure(400, "invalid_request", "The request body is not valid JSON.", context);
        }
        const input = v.safeParse(askRequestSchema, body.value);
        if (!input.success) {
          const issues = input.issues.map((issue) => ({
            path: v.getDotPath(issue) ?? "",
            message: issue.message,
          }));
          return failure(400, "invalid_request", "The question is not valid.", context, { issues });
        }

        // #region ask
        const startedAt = deps.now();
        const settle = await open(context.identity.sub);
        if (settle === null) {
          // Refused before the model is called: this answer costs nothing.
          return overBudget(context);
        }
        const caller = new AbortController();
        request.signal.addEventListener("abort", () => caller.abort(), { once: true });
        // The tools are made for this caller, here, from the identity the entry point verified.
        const tools = createNoteTools(deps.notes, context.identity.sub);
        const events = deps.assistant(input.output.question, tools, caller.signal);

        const encoder = new TextEncoder();
        let reading = true;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            void (async () => {
              let last: AssistantEvent | undefined;
              let toolCalls = 0;
              let toolErrors = 0;
              try {
                for await (const event of events) {
                  last = event;
                  if (event.type === "tool") {
                    toolCalls += 1;
                    toolErrors += event.ok ? 0 : 1;
                  }
                  if (reading) {
                    controller.enqueue(encoder.encode(sseFrame(event.type, JSON.stringify(event))));
                  }
                }
              } catch (error) {
                // A tool or the repository threw. The caller gets no `done`, which already means "not whole".
                deps.log({
                  level: "error",
                  message: "unhandled error",
                  requestId: context.requestId,
                  error: error instanceof Error ? error.stack : String(error),
                });
              } finally {
                const ended = last?.type === "done" || last?.type === "error" ? last : undefined;
                const usage = ended?.usage ?? NO_USAGE;
                await settle(usage).catch(() => undefined);
                record("assistant", context, startedAt, {
                  outcome:
                    ended?.type === "done"
                      ? ended.complete
                        ? "complete"
                        : ended.stopReason
                      : (ended?.code ?? "interrupted"),
                  turns: ended?.turns ?? 0,
                  toolCalls,
                  toolErrors,
                  usage,
                });
                if (reading) {
                  controller.close();
                }
              }
            })().catch(() => undefined);
          },
          cancel() {
            reading = false;
            caller.abort();
          },
        });
        return new Response(stream, {
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        });
        // #endregion ask
      }),
      route("POST", "/notes/:id/action-items", async (request, context, params) => {
        const note = await deps.notes.get(context.identity.sub, params["id"] ?? "");
        if (note === undefined) {
          return failure(404, "not_found", "No such note.", context);
        }
        // #region extract-route
        const startedAt = deps.now();
        const settle = await open(context.identity.sub);
        if (settle === null) {
          return overBudget(context);
        }
        const result = await deps.extract(note, request.signal);
        await settle(result.usage);
        record("action_items", context, startedAt, {
          outcome: result.ok ? "complete" : (result.stopReason ?? result.failure.code),
          turns: result.attempts,
          toolCalls: 0,
          toolErrors: 0,
          usage: result.usage,
        });
        if (!result.ok) {
          const { code, retryable } = result.failure;
          return failure(STATUS[code], code, "The action items could not be extracted.", context, {
            retryable,
          });
        }
        return Response.json({ ...result.value, attempts: result.attempts, usage: result.usage });
        // #endregion extract-route
      }),
    ],
    (_request, context) => failure(404, "not_found", "No such route.", context),
  );

  const routes = router<Context & { event: unknown }>(
    [
      route("GET", "/health", () =>
        Response.json({
          status: "ok",
          stage: env.STAGE,
          backend: env.AI_BACKEND,
          modelId: env.BEDROCK_MODEL_ID,
        }),
      ),
    ],
    // #region guard
    async (request, context) => {
      const identity = await deps.authenticate({
        event: context.event,
        authorization: request.headers.get("authorization") ?? undefined,
      });
      if (identity === undefined) {
        return failure(401, "unauthorized", "Sign in first.", context);
      }
      return signedIn(request, { requestId: context.requestId, identity });
    },
    // #endregion guard
  );

  return async (request, outside = {}) => {
    const context = { requestId: deps.newRequestId(), event: outside.event };
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
