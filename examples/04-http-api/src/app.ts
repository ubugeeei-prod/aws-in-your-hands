import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { createNoteSchema, type ErrorBody } from "./contract.ts";
import type { Env } from "./env.ts";
import type { Logger } from "./log.ts";
import type { NoteService } from "./notes.ts";

export type AppDeps = {
  env: Env;
  notes: NoteService;
  log: Logger;
  newRequestId: () => string;
  now: () => number;
};

type Variables = { requestId: string };

const failure = (
  code: ErrorBody["error"]["code"],
  message: string,
  requestId: string,
  issues?: { path: string; message: string }[],
) => ({ error: { code, message, requestId, ...(issues === undefined ? {} : { issues }) } }) satisfies ErrorBody;

// #region app
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
    cors({ origin: deps.env.ALLOWED_ORIGIN, allowMethods: ["GET", "POST", "DELETE"], allowHeaders: ["content-type"] }),
  );

  app.onError((error, c) => {
    const requestId = c.get("requestId");
    if (error instanceof HTTPException && error.status === 400) {
      // The JSON validator throws this when the body does not parse.
      return c.json(failure("invalid_request", "The request body is not valid JSON.", requestId), 400);
    }
    // The stack trace goes to the log, never to the caller.
    deps.log({
      level: "error",
      message: "unhandled error",
      requestId,
      error: error instanceof Error ? error.stack : String(error),
    });
    return c.json(failure("internal", "The request could not be completed.", requestId), 500);
  });

  app.notFound((c) => c.json(failure("not_found", "No such route.", c.get("requestId")), 404));

  return app
    .get("/health", (c) => c.json({ status: "ok" as const, stage: deps.env.STAGE }))
    .get("/notes", async (c) => c.json({ notes: await deps.notes.list() }))
    .post(
      "/notes",
      bodyLimit({
        maxSize: 64 * 1024,
        onError: (c) =>
          c.json(failure("payload_too_large", "The request body exceeds 64 KiB.", c.get("requestId")), 413),
      }),
      // Runtime check, and the request type that hc<App> shows to callers.
      validator("json", (value, c) => {
        const input = createNoteSchema.safeParse(value);
        if (!input.success) {
          const issues = input.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
          return c.json(failure("invalid_request", "The note is not valid.", c.get("requestId"), issues), 400);
        }
        return input.data;
      }),
      async (c) => c.json(await deps.notes.create(c.req.valid("json")), 201),
    )
    .get("/notes/:id", async (c) => {
      const note = await deps.notes.get(c.req.param("id"));
      return note === undefined
        ? c.json(failure("not_found", "No such note.", c.get("requestId")), 404)
        : c.json(note, 200);
    })
    .delete("/notes/:id", async (c) =>
      (await deps.notes.remove(c.req.param("id")))
        ? c.body(null, 204)
        : c.json(failure("not_found", "No such note.", c.get("requestId")), 404),
    );
}

export type App = ReturnType<typeof createApp>;
// #endregion app
