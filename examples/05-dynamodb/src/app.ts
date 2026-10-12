import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import type { z } from "zod";

import {
  createNoteSchema,
  type ErrorBody,
  listQuerySchema,
  type Note,
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

type Variables = { requestId: string };
type Extra = { issues?: { path: string; message: string }[]; current?: Note };

const failure = (
  code: ErrorBody["error"]["code"],
  message: string,
  requestId: string,
  extra: Extra = {},
) => ({ error: { code, message, requestId, ...extra } }) satisfies ErrorBody;

const issuesOf = (error: z.ZodError) =>
  error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: Variables }>();

  app.use(async (c, next) => {
    const requestId = deps.newRequestId();
    const startedAt = deps.now();
    c.set("requestId", requestId);
    await next();
    c.header("x-request-id", requestId);
    deps.log({
      level: c.res.status >= 500 ? "error" : "info",
      message: "request",
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: deps.now() - startedAt,
    });
  });

  app.use(
    cors({
      origin: deps.env.ALLOWED_ORIGIN,
      allowMethods: ["GET", "POST", "PUT", "DELETE"],
      allowHeaders: ["content-type"],
    }),
  );

  app.onError((error, c) => {
    const requestId = c.get("requestId");
    if (error instanceof HTTPException && error.status === 400) {
      return c.json(
        failure("invalid_request", "The request body is not valid JSON.", requestId),
        400,
      );
    }
    if (error instanceof InvalidCursorError) {
      return c.json(failure("invalid_request", error.message, requestId), 400);
    }
    if (error instanceof NoteQuotaError) {
      // 409, not 429: waiting does not help. Deleting a note does.
      return c.json(failure("quota_exceeded", error.message, requestId), 409);
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

  const limit = bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) =>
      c.json(
        failure("payload_too_large", "The request body exceeds 64 KiB.", c.get("requestId")),
        413,
      ),
  });

  return (
    app
      .get("/health", (c) =>
        c.json({ status: "ok" as const, stage: deps.env.STAGE, store: deps.env.NOTES_STORE }),
      )
      // #region list
      .get(
        "/notes",
        validator("query", (value, c) => {
          const query = listQuerySchema.safeParse(value);
          return query.success
            ? query.data
            : c.json(
                failure("invalid_request", "The query is not valid.", c.get("requestId"), {
                  issues: issuesOf(query.error),
                }),
                400,
              );
        }),
        async (c) => c.json(await deps.notes.list(SHARED_OWNER, c.req.valid("query"))),
      )
      // #endregion list
      .post(
        "/notes",
        limit,
        validator("json", (value, c) => {
          const input = createNoteSchema.safeParse(value);
          return input.success
            ? input.data
            : c.json(
                failure("invalid_request", "The note is not valid.", c.get("requestId"), {
                  issues: issuesOf(input.error),
                }),
                400,
              );
        }),
        async (c) => c.json(await deps.notes.create(SHARED_OWNER, c.req.valid("json")), 201),
      )
      .get("/notes/:id", async (c) => {
        const note = await deps.notes.get(SHARED_OWNER, c.req.param("id"));
        return note === undefined
          ? c.json(failure("not_found", "No such note.", c.get("requestId")), 404)
          : c.json(note, 200);
      })
      // #region update
      .put(
        "/notes/:id",
        limit,
        validator("json", (value, c) => {
          const input = updateNoteSchema.safeParse(value);
          return input.success
            ? input.data
            : c.json(
                failure("invalid_request", "The update is not valid.", c.get("requestId"), {
                  issues: issuesOf(input.error),
                }),
                400,
              );
        }),
        async (c) => {
          const result = await deps.notes.update(
            SHARED_OWNER,
            c.req.param("id"),
            c.req.valid("json"),
          );
          switch (result.status) {
            case "updated":
              return c.json(result.note, 200);
            case "not_found":
              return c.json(failure("not_found", "No such note.", c.get("requestId")), 404);
            case "conflict":
              // 409: well-formed, but based on a version that is no longer stored.
              return c.json(
                failure(
                  "conflict",
                  "The note was changed since you loaded it.",
                  c.get("requestId"),
                  {
                    current: result.current,
                  },
                ),
                409,
              );
          }
        },
      )
      // #endregion update
      .delete("/notes/:id", async (c) =>
        (await deps.notes.remove(SHARED_OWNER, c.req.param("id")))
          ? c.body(null, 204)
          : c.json(failure("not_found", "No such note.", c.get("requestId")), 404),
      )
  );
}

export type App = ReturnType<typeof createApp>;
