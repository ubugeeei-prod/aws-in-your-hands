import * as v from "valibot";

import { readJson } from "@aih/example-04-http-api/src/http/body.ts";
import { cors } from "@aih/example-04-http-api/src/http/cors.ts";
import {
  type Fetch,
  type Handler,
  route,
  router,
} from "@aih/example-04-http-api/src/http/router.ts";

import { createNoteSchema, type ErrorBody, type Note, updateNoteSchema } from "./contract.ts";
import type { Env } from "./env.ts";
import type { Logger } from "./log.ts";
import { type NoteService, SHARED_OWNER } from "./notes.ts";
import { RetriesExhaustedError } from "./transaction.ts";

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

const noteIdSchema = v.pipe(v.string(), v.uuid());

// The id column is a uuid. Anything else can match no row, and would make
// PostgreSQL raise an error instead of returning none.
const isNoteId = (value: string): boolean => v.is(noteIdSchema, value);

type Input<Value> = { ok: true; value: Value } | { ok: false; response: Response };

// POST and PUT read a body the same way: at most 64 KiB, JSON, then the schema.
async function readInput<Value>(
  request: Request,
  schema: v.GenericSchema<unknown, Value>,
  invalid: string,
  context: Context,
): Promise<Input<Value>> {
  const body = await readJson(request, 64 * 1024);
  if (!body.ok) {
    return {
      ok: false,
      response:
        body.reason === "too_large"
          ? failure(413, "payload_too_large", "The request body exceeds 64 KiB.", context)
          : failure(400, "invalid_request", "The request body is not valid JSON.", context),
    };
  }
  const input = v.safeParse(schema, body.value);
  if (!input.success) {
    const issues = input.issues.map((issue) => ({
      path: v.getDotPath(issue) ?? "",
      message: issue.message,
    }));
    return { ok: false, response: failure(400, "invalid_request", invalid, context, { issues }) };
  }
  return { ok: true, value: input.output };
}

export function createApp(deps: AppDeps): Fetch {
  const routes = router<Context>(
    [
      route("GET", "/health", () =>
        Response.json({ status: "ok", stage: deps.env.STAGE, db: deps.env.NOTES_DB }),
      ),
      route("GET", "/notes", async () =>
        Response.json({ notes: await deps.notes.list(SHARED_OWNER) }),
      ),
      route("POST", "/notes", async (request, context) => {
        const input = await readInput(request, createNoteSchema, "The note is not valid.", context);
        if (!input.ok) {
          return input.response;
        }
        const note = await deps.notes.create(SHARED_OWNER, input.value);
        return note === "quota_exceeded"
          ? failure(409, "quota_exceeded", "This owner has no room for another note.", context)
          : Response.json(note, { status: 201 });
      }),
      route("GET", "/notes/:id", async (_request, context, { id = "" }) => {
        const note = isNoteId(id) ? await deps.notes.get(SHARED_OWNER, id) : undefined;
        return note === undefined
          ? failure(404, "not_found", "No such note.", context)
          : Response.json(note);
      }),
      route("PUT", "/notes/:id", async (request, context, { id = "" }) => {
        const input = await readInput(
          request,
          updateNoteSchema,
          "The update is not valid.",
          context,
        );
        if (!input.ok) {
          return input.response;
        }
        const result = isNoteId(id)
          ? await deps.notes.update(SHARED_OWNER, id, input.value)
          : ({ status: "not_found" } as const);
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
        isNoteId(id) && (await deps.notes.remove(SHARED_OWNER, id))
          ? new Response(null, { status: 204 })
          : failure(404, "not_found", "No such note.", context),
      ),
    ],
    (_request, context) => failure(404, "not_found", "No such route.", context),
  );

  // #region errors
  // Inside the CORS step, so a page on the allowed origin can read these answers too.
  const caught: Handler<Context> = async (request, context) => {
    try {
      return await routes(request, context);
    } catch (error) {
      if (error instanceof RetriesExhaustedError) {
        // Every attempt was rolled back, so the caller may simply send it again.
        const response = failure(
          503,
          "busy",
          "The database is busy. Nothing was changed; try again.",
          context,
        );
        response.headers.set("retry-after", "1");
        return response;
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
  // #endregion errors

  const answer = cors(
    {
      origin: deps.env.ALLOWED_ORIGIN,
      allowMethods: ["GET", "POST", "PUT", "DELETE"],
      allowHeaders: ["content-type"],
    },
    caught,
  );

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
