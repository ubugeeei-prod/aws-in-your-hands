import * as v from "valibot";

import { readJson } from "@aih/example-04-http-api/src/http/body.ts";
import { cors } from "@aih/example-04-http-api/src/http/cors.ts";
import {
  type Handler,
  type Route,
  route,
  router,
} from "@aih/example-04-http-api/src/http/router.ts";
import type { Env } from "@aih/example-05-dynamodb/src/env.ts";
import type { Logger } from "@aih/example-05-dynamodb/src/log.ts";
import { NoteQuotaError, type NoteService } from "@aih/example-05-dynamodb/src/notes.ts";
import { InvalidCursorError } from "@aih/example-05-dynamodb/src/repository.ts";

import {
  createNoteSchema,
  type ErrorBody,
  listQuerySchema,
  MAX_NOTES_PER_OWNER,
  type Note,
  type NoteList,
  toNoteSummary,
  updateNoteSchema,
} from "./contract.ts";
import type { Authenticate, Identity } from "./identity.ts";

export type AppDeps = {
  env: Env;
  notes: NoteService;
  authenticate: Authenticate;
  log: Logger;
  newRequestId: () => string;
  now: () => number;
};

// #region context
/** What an entry point knows besides the request. On Lambda that is the event. Elsewhere, nothing. */
export type Outside = { event?: unknown };

/** A request in, a response out, as in chapter 05, plus what the entry point hands over. */
export type App = (request: Request, outside?: Outside) => Promise<Response>;

/** What a route behind the guard sees. `identity` is not optional there. */
export type SignedIn = { requestId: string; identity: Identity };

type Context = { requestId: string; event: unknown; identity?: Identity };
// #endregion context

type Extra = { issues?: { path: string; message: string }[]; current?: Note };

const failure = (
  status: number,
  code: ErrorBody["error"]["code"],
  message: string,
  { requestId }: { requestId: string },
  extra: Extra = {},
) =>
  Response.json({ error: { code, message, requestId, ...extra } } satisfies ErrorBody, { status });

const issuesOf = (issues: readonly v.BaseIssue<unknown>[]) =>
  issues.map((issue) => ({ path: v.getDotPath(issue) ?? "", message: issue.message }));

const MAX_BODY_BYTES = 64 * 1024;

const unreadable = (reason: "too_large" | "invalid_json", context: SignedIn) =>
  reason === "too_large"
    ? failure(413, "payload_too_large", "The request body exceeds 64 KiB.", context)
    : failure(400, "invalid_request", "The request body is not valid JSON.", context);

/** `more` is for the chapters after this one: their routes go behind the same guard. */
export function createApp(deps: AppDeps, more: Route<SignedIn>[] = []): App {
  // #region routes
  // The owner is always the caller's own `sub`, never the path, query, or
  // body. Notes live under their owner, so there is no separate check to forget.
  const signedIn = router<SignedIn>(
    [
      route("GET", "/me", (_request, { identity }) => Response.json({ sub: identity.sub })),
      route("GET", "/notes", async (request, context) => {
        const query = v.safeParse(
          listQuerySchema,
          Object.fromEntries(new URL(request.url).searchParams),
        );
        if (!query.success) {
          return failure(400, "invalid_request", "The query is not valid.", context, {
            issues: issuesOf(query.issues),
          });
        }
        const page = await deps.notes.list(context.identity.sub, query.output);
        // As in chapter 05: summaries, no bodies.
        const list: NoteList = {
          notes: page.notes.map(toNoteSummary),
          nextCursor: page.nextCursor,
        };
        return Response.json(list);
      }),
      route("POST", "/notes", async (request, context) => {
        const body = await readJson(request, MAX_BODY_BYTES);
        if (!body.ok) {
          return unreadable(body.reason, context);
        }
        const input = v.safeParse(createNoteSchema, body.value);
        if (!input.success) {
          return failure(400, "invalid_request", "The note is not valid.", context, {
            issues: issuesOf(input.issues),
          });
        }
        return Response.json(await deps.notes.create(context.identity.sub, input.output), {
          status: 201,
        });
      }),
      route("GET", "/notes/:id", async (_request, context, { id = "" }) => {
        const note = await deps.notes.get(context.identity.sub, id);
        return note === undefined
          ? failure(404, "not_found", "No such note.", context)
          : Response.json(note);
      }),
      route("PUT", "/notes/:id", async (request, context, { id = "" }) => {
        const body = await readJson(request, MAX_BODY_BYTES);
        if (!body.ok) {
          return unreadable(body.reason, context);
        }
        const input = v.safeParse(updateNoteSchema, body.value);
        if (!input.success) {
          return failure(400, "invalid_request", "The update is not valid.", context, {
            issues: issuesOf(input.issues),
          });
        }
        const result = await deps.notes.update(context.identity.sub, id, input.output);
        switch (result.status) {
          case "updated":
            return Response.json(result.note);
          case "not_found":
            return failure(404, "not_found", "No such note.", context);
          case "conflict":
            return failure(409, "conflict", "The note was changed since you loaded it.", context, {
              current: result.current,
            });
        }
      }),
      route("DELETE", "/notes/:id", async (_request, context, { id = "" }) =>
        (await deps.notes.remove(context.identity.sub, id))
          ? new Response(null, { status: 204 })
          : failure(404, "not_found", "No such note.", context),
      ),
      ...more,
    ],
    (_request, context) => failure(404, "not_found", "No such route.", context),
  );
  // #endregion routes

  // #region guard
  // /health is the one route in front of the guard and stays open. Anything else
  // reaches a route only with an identity, an unknown path included.
  const routes = router<Context>(
    [route("GET", "/health", () => Response.json({ status: "ok", stage: deps.env.STAGE }))],
    async (request, context) => {
      const identity = await deps.authenticate({
        event: context.event,
        authorization: request.headers.get("authorization") ?? undefined,
      });
      if (identity === undefined) {
        return failure(401, "unauthenticated", "Sign in to use this API.", context);
      }
      // Kept on the context for the log line below.
      context.identity = identity;
      return signedIn(request, { requestId: context.requestId, identity });
    },
  );
  // #endregion guard

  // A route that throws still owes the caller an answer in the usual shape.
  const caught: Handler<Context> = async (request, context) => {
    try {
      return await routes(request, context);
    } catch (error) {
      if (error instanceof InvalidCursorError) {
        return failure(400, "invalid_request", error.message, context);
      }
      if (error instanceof NoteQuotaError) {
        // 409, not 429: waiting does not help. Deleting a note does.
        return failure(
          409,
          "quota_exceeded",
          `An account holds at most ${MAX_NOTES_PER_OWNER} notes. Delete one first.`,
          context,
        );
      }
      // The stack trace goes to the log, never to the caller.
      deps.log({
        level: "error",
        message: "unhandled error",
        requestId: context.requestId,
        error: error instanceof Error ? error.stack : String(error),
      });
      return failure(500, "internal", "The request could not be completed.", context);
    }
  };

  // Outside the catch and outside the guard: a 401 and a 500 carry the CORS headers too,
  // and a preflight, which a browser sends without a token, is answered before the guard.
  const answer = cors(
    {
      origin: deps.env.ALLOWED_ORIGIN,
      allowMethods: ["GET", "POST", "PUT", "DELETE"],
      allowHeaders: ["content-type", "authorization"],
    },
    caught,
  );

  return async (request, outside) => {
    const context: Context = { requestId: deps.newRequestId(), event: outside?.event };
    const startedAt = deps.now();
    const response = await answer(request, context);
    response.headers.set("x-request-id", context.requestId);
    deps.log({
      level: response.status >= 500 ? "error" : "info",
      message: "request",
      requestId: context.requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      status: response.status,
      // For the audit trail. Never the token itself.
      sub: context.identity?.sub,
      durationMs: deps.now() - startedAt,
    });
    return response;
  };
}
