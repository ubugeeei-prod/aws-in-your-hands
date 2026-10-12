import * as v from "valibot";

import { readJson } from "@aih/example-04-http-api/src/http/body.ts";
import { cors } from "@aih/example-04-http-api/src/http/cors.ts";
import {
  type Fetch,
  type Handler,
  route,
  router,
} from "@aih/example-04-http-api/src/http/router.ts";

import {
  createNoteSchema,
  type ErrorBody,
  listQuerySchema,
  type Note,
  type NoteList,
  toNoteSummary,
  updateNoteSchema,
} from "./contract.ts";
import type { Env } from "./env.ts";
import type { Logger } from "./log.ts";
import { NoteQuotaError, type NoteService, SHARED_OWNER } from "./notes.ts";
import { InvalidCursorError } from "./repository.ts";

export type AppDeps = {
  env: Env;
  notes: NoteService;
  log: Logger;
  newRequestId: () => string;
  now: () => number;
};

/** What every route sees besides the request. */
type Context = { requestId: string };
type Extra = { issues?: { path: string; message: string }[]; current?: Note };

const failure = (
  status: number,
  code: ErrorBody["error"]["code"],
  message: string,
  { requestId }: Context,
  extra: Extra = {},
) =>
  Response.json({ error: { code, message, requestId, ...extra } } satisfies ErrorBody, { status });

const issuesOf = (issues: readonly v.BaseIssue<unknown>[]) =>
  issues.map((issue) => ({ path: v.getDotPath(issue) ?? "", message: issue.message }));

const MAX_BODY_BYTES = 64 * 1024;

const unreadable = (reason: "too_large" | "invalid_json", context: Context) =>
  reason === "too_large"
    ? failure(413, "payload_too_large", "The request body exceeds 64 KiB.", context)
    : failure(400, "invalid_request", "The request body is not valid JSON.", context);

export function createApp(deps: AppDeps): Fetch {
  const routes = router<Context>(
    [
      route("GET", "/health", () =>
        Response.json({ status: "ok", stage: deps.env.STAGE, store: deps.env.NOTES_STORE }),
      ),
      // #region list
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
        const page = await deps.notes.list(SHARED_OWNER, query.output);
        // The repository reads whole notes. The response leaves the bodies out.
        const list: NoteList = {
          notes: page.notes.map(toNoteSummary),
          nextCursor: page.nextCursor,
        };
        return Response.json(list);
      }),
      // #endregion list
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
        return Response.json(await deps.notes.create(SHARED_OWNER, input.output), { status: 201 });
      }),
      route("GET", "/notes/:id", async (_request, context, { id = "" }) => {
        const note = await deps.notes.get(SHARED_OWNER, id);
        return note === undefined
          ? failure(404, "not_found", "No such note.", context)
          : Response.json(note);
      }),
      // #region update
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
        const result = await deps.notes.update(SHARED_OWNER, id, input.output);
        switch (result.status) {
          case "updated":
            return Response.json(result.note);
          case "not_found":
            return failure(404, "not_found", "No such note.", context);
          case "conflict":
            // 409: well-formed, but based on a version that is no longer stored.
            return failure(409, "conflict", "The note was changed since you loaded it.", context, {
              current: result.current,
            });
        }
      }),
      // #endregion update
      route("DELETE", "/notes/:id", async (_request, context, { id = "" }) =>
        (await deps.notes.remove(SHARED_OWNER, id))
          ? new Response(null, { status: 204 })
          : failure(404, "not_found", "No such note.", context),
      ),
    ],
    (_request, context) => failure(404, "not_found", "No such route.", context),
  );

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
        return failure(409, "quota_exceeded", error.message, context);
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

  // Outside the catch, so an error answer carries the CORS headers too.
  const answer = cors(
    {
      origin: deps.env.ALLOWED_ORIGIN,
      allowMethods: ["GET", "POST", "PUT", "DELETE"],
      allowHeaders: ["content-type"],
    },
    caught,
  );

  // What happens to every request: an ID on the way in, a header and a log line on the way out.
  return async (request) => {
    const context = { requestId: deps.newRequestId() };
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
      durationMs: deps.now() - startedAt,
    });
    return response;
  };
}
