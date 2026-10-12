import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import type { z } from "zod";

import type { Env } from "@aih/example-05-dynamodb/src/env.ts";
import type { Logger } from "@aih/example-05-dynamodb/src/log.ts";
import type { NoteService } from "@aih/example-05-dynamodb/src/notes.ts";
import { InvalidCursorError } from "@aih/example-05-dynamodb/src/repository.ts";

import {
  createNoteSchema,
  type ErrorBody,
  listQuerySchema,
  type Note,
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

type Bindings = { event?: unknown };
type Variables = { requestId: string; identity: Identity };
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
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

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
      // For the audit trail. Never the token itself.
      sub: c.get("identity")?.sub,
      durationMs: deps.now() - startedAt,
    });
  });

  app.use(
    cors({
      origin: deps.env.ALLOWED_ORIGIN,
      allowMethods: ["GET", "POST", "PUT", "DELETE"],
      allowHeaders: ["content-type", "authorization"],
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
      // #region guard
      // /health is registered first and stays open. Every route below needs an identity.
      .get("/health", (c) => c.json({ status: "ok" as const, stage: deps.env.STAGE }))
      .use(async (c, next) => {
        const identity = await deps.authenticate({
          event: c.env?.event,
          authorization: c.req.header("authorization"),
        });
        if (identity === undefined) {
          return c.json(
            failure("unauthenticated", "Sign in to use this API.", c.get("requestId")),
            401,
          );
        }
        c.set("identity", identity);
        await next();
      })
      // #endregion guard
      // #region routes
      // The owner is always the caller's own `sub`, never the path, query, or
      // body. Notes live under their owner, so there is no separate check to forget.
      .get("/me", (c) => c.json({ sub: c.get("identity").sub }))
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
        async (c) => c.json(await deps.notes.list(c.get("identity").sub, c.req.valid("query"))),
      )
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
        async (c) =>
          c.json(await deps.notes.create(c.get("identity").sub, c.req.valid("json")), 201),
      )
      .get("/notes/:id", async (c) => {
        const note = await deps.notes.get(c.get("identity").sub, c.req.param("id"));
        return note === undefined
          ? c.json(failure("not_found", "No such note.", c.get("requestId")), 404)
          : c.json(note, 200);
      })
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
            c.get("identity").sub,
            c.req.param("id"),
            c.req.valid("json"),
          );
          switch (result.status) {
            case "updated":
              return c.json(result.note, 200);
            case "not_found":
              return c.json(failure("not_found", "No such note.", c.get("requestId")), 404);
            case "conflict":
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
      .delete("/notes/:id", async (c) =>
        (await deps.notes.remove(c.get("identity").sub, c.req.param("id")))
          ? c.body(null, 204)
          : c.json(failure("not_found", "No such note.", c.get("requestId")), 404),
      )
    // #endregion routes
  );
}

export type App = ReturnType<typeof createApp>;
