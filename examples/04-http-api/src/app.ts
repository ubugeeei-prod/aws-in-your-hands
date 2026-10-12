import * as v from "valibot";

import { createNoteSchema, type ErrorBody } from "./contract.ts";
import type { Env } from "./env.ts";
import { readJson } from "./http/body.ts";
import { cors } from "./http/cors.ts";
import { type Fetch, route, router } from "./http/router.ts";
import type { Logger } from "./log.ts";
import { NoteLimitError, type NoteService } from "./notes.ts";

export type AppDeps = {
  env: Env;
  notes: NoteService;
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
  issues?: { path: string; message: string }[],
) =>
  Response.json(
    {
      error: { code, message, requestId, ...(issues === undefined ? {} : { issues }) },
    } satisfies ErrorBody,
    { status },
  );

// #region app
export function createApp(deps: AppDeps): Fetch {
  // #region routes
  const routes = router<Context>(
    [
      route("GET", "/health", () => Response.json({ status: "ok", stage: deps.env.STAGE })),
      route("GET", "/notes", async () => Response.json({ notes: await deps.notes.list() })),
      route("POST", "/notes", async (request, context) => {
        const body = await readJson(request, 64 * 1024);
        if (!body.ok) {
          return body.reason === "too_large"
            ? failure(413, "payload_too_large", "The request body exceeds 64 KiB.", context)
            : failure(400, "invalid_request", "The request body is not valid JSON.", context);
        }
        // The type says what the code expects. This line is what checks it.
        const input = v.safeParse(createNoteSchema, body.value);
        if (!input.success) {
          const issues = input.issues.map((issue) => ({
            path: v.getDotPath(issue) ?? "",
            message: issue.message,
          }));
          return failure(400, "invalid_request", "The note is not valid.", context, issues);
        }
        return Response.json(await deps.notes.create(input.output), { status: 201 });
      }),
      route("GET", "/notes/:id", async (_request, context, { id = "" }) => {
        const note = await deps.notes.get(id);
        return note === undefined
          ? failure(404, "not_found", "No such note.", context)
          : Response.json(note);
      }),
      route("DELETE", "/notes/:id", async (_request, context, { id = "" }) =>
        (await deps.notes.remove(id))
          ? new Response(null, { status: 204 })
          : failure(404, "not_found", "No such note.", context),
      ),
    ],
    (_request, context) => failure(404, "not_found", "No such route.", context),
  );
  // #endregion routes

  const answer = cors(
    {
      origin: deps.env.ALLOWED_ORIGIN,
      allowMethods: ["GET", "POST", "DELETE"],
      allowHeaders: ["content-type"],
    },
    routes,
  );

  // #region around
  // Everything that happens to every request, in the order it happens.
  return async (request) => {
    const context = { requestId: deps.newRequestId() };
    const startedAt = deps.now();
    let response: Response;
    try {
      response = await answer(request, context);
    } catch (error) {
      if (error instanceof NoteLimitError) {
        // 409, not 429: waiting does not help. Deleting a note does.
        response = failure(
          409,
          "quota_exceeded",
          "The store is full. Delete a note first.",
          context,
        );
      } else {
        // The stack trace goes to the log, never to the caller.
        deps.log({
          level: "error",
          message: "unhandled error",
          requestId: context.requestId,
          error: error instanceof Error ? error.stack : String(error),
        });
        response = failure(500, "internal", "The request could not be completed.", context);
      }
    }
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
  // #endregion around
}
// #endregion app
