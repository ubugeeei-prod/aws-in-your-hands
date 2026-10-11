import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { type ErrorBody, type ShareNotificationResult, shareNotificationSchema } from "./contract.ts";
import type { Logger } from "./log.ts";
import { type NotifyDeps, sendShareNotification } from "./notify.ts";

export type AppDeps = {
  stage: string;
  mode: "local" | "aws";
  notify: NotifyDeps;
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

  app.onError((error, c) => {
    const requestId = c.get("requestId");
    if (error instanceof HTTPException && error.status === 400) {
      return c.json(failure("invalid_request", "The request body is not valid JSON.", requestId), 400);
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

  return app
    .get("/health", (c) => c.json({ status: "ok" as const, stage: deps.stage, mode: deps.mode }))
    .post(
      "/share-notifications",
      bodyLimit({
        maxSize: 16 * 1024,
        onError: (c) =>
          c.json(failure("payload_too_large", "The request body exceeds 16 KiB.", c.get("requestId")), 413),
      }),
      validator("json", (value, c) => {
        const input = shareNotificationSchema.safeParse(value);
        if (!input.success) {
          const issues = input.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
          return c.json(failure("invalid_request", "The notification is not valid.", c.get("requestId"), issues), 400);
        }
        return input.data;
      }),
      async (c) => {
        const input = c.req.valid("json");
        const notificationId = input.notificationId;
        const result = await sendShareNotification(deps.notify, input);
        const requestId = c.get("requestId");
        switch (result.outcome) {
          case "sent":
            // 202: accepted for delivery. Arrival is a later event, not this response.
            return c.json(
              { status: "accepted", notificationId, messageId: result.messageId } satisfies ShareNotificationResult,
              202,
            );
          case "duplicate":
            return c.json(
              { status: "duplicate", notificationId, state: result.state } satisfies ShareNotificationResult,
              200,
            );
          case "suppressed":
            return c.json(
              { status: "suppressed", notificationId, reason: result.reason } satisfies ShareNotificationResult,
              200,
            );
          case "conflict":
            return c.json(
              failure("idempotency_conflict", "This notificationId was used for a different mail.", requestId),
              409,
            );
          case "rejected":
            deps.log({ level: "warn", message: "send rejected", requestId, notificationId, reason: result.reason });
            return c.json(
              failure(
                "send_rejected",
                "The mail was refused and not sent. The same request may be retried.",
                requestId,
              ),
              502,
            );
          case "unknown":
            return c.json(
              failure(
                "send_unknown",
                "It is not known whether the mail was sent. Retrying this notificationId will not send it again.",
                requestId,
              ),
              502,
            );
        }
      },
    )
    .get("/share-notifications/:id", async (c) => {
      const record = await deps.notify.store.get(c.req.param("id"));
      if (record === undefined) {
        return c.json(failure("not_found", "No such notification.", c.get("requestId")), 404);
      }
      const { fingerprint: _fingerprint, expiresAt: _expiresAt, ...status } = record;
      return c.json(status, 200);
    });
}

export type App = ReturnType<typeof createApp>;
// #endregion app
