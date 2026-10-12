import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { z } from "zod";

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

// The id column is a uuid. Anything else can match no row, and would make
// PostgreSQL raise an error instead of returning none.
const isNoteId = (value: string): boolean => z.uuid().safeParse(value).success;

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

  // #region errors
  app.onError((error, c) => {
    const requestId = c.get("requestId");
    if (error instanceof HTTPException && error.status === 400) {
      return c.json(
        failure("invalid_request", "The request body is not valid JSON.", requestId),
        400,
      );
    }
    if (error instanceof RetriesExhaustedError) {
      // Every attempt was rolled back, so the caller may simply send it again.
      c.header("retry-after", "1");
      return c.json(
        failure("busy", "The database is busy. Nothing was changed; try again.", requestId),
        503,
      );
    }
    deps.log({
      level: "error",
      message: "unhandled error",
      requestId,
      error: error instanceof Error ? error.stack : String(error),
    });
    return c.json(failure("internal", "The request could not be completed.", requestId), 500);
  });
  // #endregion errors

  app.notFound((c) => c.json(failure("not_found", "No such route.", c.get("requestId")), 404));

  const limit = bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) =>
      c.json(
        failure("payload_too_large", "The request body exceeds 64 KiB.", c.get("requestId")),
        413,
      ),
  });

  return app
    .get("/health", (c) =>
      c.json({ status: "ok" as const, stage: deps.env.STAGE, db: deps.env.NOTES_DB }),
    )
    .get("/notes", async (c) => c.json({ notes: await deps.notes.list(SHARED_OWNER) }))
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
      async (c) => {
        const note = await deps.notes.create(SHARED_OWNER, c.req.valid("json"));
        return note === "quota_exceeded"
          ? c.json(
              failure(
                "quota_exceeded",
                "This owner has no room for another note.",
                c.get("requestId"),
              ),
              409,
            )
          : c.json(note, 201);
      },
    )
    .get("/notes/:id", async (c) => {
      const id = c.req.param("id");
      const note = isNoteId(id) ? await deps.notes.get(SHARED_OWNER, id) : undefined;
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
        const id = c.req.param("id");
        const result = isNoteId(id)
          ? await deps.notes.update(SHARED_OWNER, id, c.req.valid("json"))
          : ({ status: "not_found" } as const);
        switch (result.status) {
          case "updated":
            return c.json(result.note, 200);
          case "not_found":
            return c.json(failure("not_found", "No such note.", c.get("requestId")), 404);
          case "conflict":
            return c.json(
              failure("conflict", "The note was changed since you loaded it.", c.get("requestId"), {
                current: result.current,
              }),
              409,
            );
        }
      },
    )
    .delete("/notes/:id", async (c) => {
      const id = c.req.param("id");
      return isNoteId(id) && (await deps.notes.remove(SHARED_OWNER, id))
        ? c.body(null, 204)
        : c.json(failure("not_found", "No such note.", c.get("requestId")), 404);
    });
}

export type App = ReturnType<typeof createApp>;
