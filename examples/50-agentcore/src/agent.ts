import * as v from "valibot";

import { readJson } from "@aih/example-04-http-api/src/http/body.ts";
import { type Fetch, route, router } from "@aih/example-04-http-api/src/http/router.ts";
import type { Logger } from "@aih/example-04-http-api/src/log.ts";
import type { Authenticate } from "@aih/example-06-auth/api/src/identity.ts";
import { sseFrame } from "@aih/example-17-ai/src/sse.ts";
import type { AssistantEvent } from "@aih/example-36-bedrock/src/contract.ts";
import { type AssistantDeps, createAssistant } from "@aih/example-36-bedrock/src/loop.ts";
import { createNoteTools, type NoteReader } from "@aih/example-36-bedrock/src/tools.ts";

import { type ErrorBody, invocationSchema, SESSION_HEADER } from "./contract.ts";
import { withHistory } from "./history.ts";
import type { MemoryStore } from "./memory-store.ts";
import { ownsSession, sessionIdSchema } from "./session-id.ts";
import { reduce, replay, type SessionState, toHistory, type TurnEvent } from "./session.ts";

export type AgentDeps = {
  /** Who is calling. The runtime entry point and the local one each supply their own. */
  authenticate: Authenticate;
  notes: NoteReader;
  store: MemoryStore;
  /** Chapter 36's loop, with its limits and its model. */
  assistant: AssistantDeps;
  log: Logger;
  newRequestId: () => string;
};

type Context = { requestId: string };

// #region session
/** What this process holds for one session. `writing` is the write in progress, if any. */
type Session = { state: SessionState; writing: Promise<void> };
// #endregion session

const MAX_BODY_BYTES = 16 * 1024;

const failure = (
  status: number,
  code: ErrorBody["error"]["code"],
  message: string,
  { requestId }: Context,
) => Response.json({ error: { code, message, requestId } } satisfies ErrorBody, { status });

/** The two paths AgentCore Runtime's HTTP contract asks of an agent, as one `Fetch`. */
export function createAgent(deps: AgentDeps): Fetch {
  // On AgentCore Runtime one process serves one session, so this holds one entry. The
  // local server serves every session from one process, and the same code has to hold.
  const sessions = new Map<string, Session>();

  // #region open
  /** What the session remembers. Loaded from the store the first time this process sees it. */
  async function open(sessionId: string, owner: string) {
    let session = sessions.get(sessionId);
    if (session === undefined) {
      // Asked for by the owner's ID: another actor's events are never in the answer.
      const state = replay(await deps.store.load(owner, sessionId));
      // Another request may have opened the session while this one waited for the store.
      session = sessions.get(sessionId) ?? { state, writing: Promise.resolve() };
      sessions.set(sessionId, session);
    }
    return session;
  }
  // #endregion open

  const routes = router<Context>(
    [
      // #region ping
      // Never HealthyBusy: this agent does no work between requests, so an idle session may end.
      route("GET", "/ping", () => Response.json({ status: "Healthy" })),
      // #endregion ping
      route("POST", "/invocations", async (request, context) => {
        // #region guard
        const sessionId = v.safeParse(sessionIdSchema, request.headers.get(SESSION_HEADER));
        if (!sessionId.success) {
          return failure(
            400,
            "invalid_request",
            "A session ID made for the caller is required.",
            context,
          );
        }
        const identity = await deps.authenticate({
          event: undefined,
          authorization: request.headers.get("authorization") ?? undefined,
        });
        if (identity === undefined) {
          return failure(401, "unauthorized", "Sign in first.", context);
        }
        // A session ID is not a credential. It has to be one that was made for this caller.
        if (!ownsSession(identity.sub, sessionId.output)) {
          deps.log({
            level: "warn",
            message: "session owner mismatch",
            requestId: context.requestId,
            sessionId: sessionId.output,
            caller: identity.sub,
          });
          return failure(
            403,
            "session_owner_mismatch",
            "This session belongs to someone else.",
            context,
          );
        }
        const body = await readJson(request, MAX_BODY_BYTES);
        if (!body.ok) {
          return body.reason === "too_large"
            ? failure(413, "payload_too_large", "The request body exceeds 16 KiB.", context)
            : failure(400, "invalid_request", "The request body is not valid JSON.", context);
        }
        const input = v.safeParse(invocationSchema, body.value);
        if (!input.success) {
          return failure(
            400,
            "invalid_request",
            'The body must be { "prompt": string } and nothing else.',
            context,
          );
        }
        // #endregion guard

        // #region invoke
        const session = await open(sessionId.output, identity.sub);
        const question = input.output.prompt;
        // Made for this request, from the identity checked a few lines up. Nothing about
        // the caller is kept between requests.
        const tools = createNoteTools(deps.notes, identity.sub);
        const assistant = createAssistant({
          ...deps.assistant,
          gateway: withHistory(deps.assistant.gateway, toHistory(session.state)),
        });
        const caller = new AbortController();
        request.signal.addEventListener("abort", () => caller.abort(), { once: true });
        const events = assistant(question, tools, caller.signal);

        /** Writes the exchange to the store first, and only then lets this process remember it. */
        const remember = (answer: string): Promise<boolean> => {
          // One write at a time per session: two answers that finish together would
          // otherwise both take the same number, and the store would keep only one.
          const written = session.writing.then(async () => {
            const turn: TurnEvent = {
              type: "turn",
              seq: session.state.turns + 1,
              question,
              answer,
            };
            try {
              await deps.store.append(identity.sub, sessionId.output, turn);
            } catch (error) {
              deps.log({
                level: "warn",
                message: "turn not remembered",
                requestId: context.requestId,
                error: error instanceof Error ? error.message : String(error),
              });
              return false;
            }
            session.state = reduce(session.state, turn);
            return true;
          });
          session.writing = written.then(() => undefined);
          return written;
        };
        // #endregion invoke

        const encoder = new TextEncoder();
        let reading = true;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            void (async () => {
              let last: AssistantEvent | undefined;
              let answer = "";
              let remembered = false;
              try {
                for await (const event of events) {
                  last = event;
                  if (event.type === "delta") {
                    answer += event.text;
                  }
                  // Only an answer the model finished on its own is worth repeating to it later.
                  if (event.type === "done" && event.complete) {
                    remembered = await remember(answer);
                  }
                  if (reading) {
                    controller.enqueue(encoder.encode(sseFrame(event.type, JSON.stringify(event))));
                  }
                }
              } catch (error) {
                deps.log({
                  level: "error",
                  message: "unhandled error",
                  requestId: context.requestId,
                  error: error instanceof Error ? error.stack : String(error),
                });
              } finally {
                deps.log({
                  level: last?.type === "done" && last.complete ? "info" : "warn",
                  message: "invocation",
                  requestId: context.requestId,
                  sessionId: sessionId.output,
                  owner: identity.sub,
                  outcome:
                    last?.type === "done"
                      ? last.complete
                        ? "complete"
                        : last.stopReason
                      : last?.type === "error"
                        ? last.code
                        : "interrupted",
                  remembered,
                  turnsRemembered: session.state.turns,
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
