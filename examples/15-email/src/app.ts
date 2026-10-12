import * as v from "valibot";

import { readJson } from "@aih/example-04-http-api/src/http/body.ts";
import { type Fetch, route, router } from "@aih/example-04-http-api/src/http/router.ts";

import {
  type ErrorBody,
  type ShareNotificationResult,
  shareNotificationSchema,
} from "./contract.ts";
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

const result = (status: number, body: ShareNotificationResult) => Response.json(body, { status });

// #region app
export function createApp(deps: AppDeps): Fetch {
  const routes = router<Context>(
    [
      route("GET", "/health", () =>
        Response.json({ status: "ok", stage: deps.stage, mode: deps.mode }),
      ),
      route("POST", "/share-notifications", async (request, context) => {
        const body = await readJson(request, 16 * 1024);
        if (!body.ok) {
          return body.reason === "too_large"
            ? failure(413, "payload_too_large", "The request body exceeds 16 KiB.", context)
            : failure(400, "invalid_request", "The request body is not valid JSON.", context);
        }
        const input = v.safeParse(shareNotificationSchema, body.value);
        if (!input.success) {
          const issues = input.issues.map((issue) => ({
            path: v.getDotPath(issue) ?? "",
            message: issue.message,
          }));
          return failure(400, "invalid_request", "The notification is not valid.", context, issues);
        }
        const notificationId = input.output.notificationId;
        const sent = await sendShareNotification(deps.notify, input.output);
        switch (sent.outcome) {
          case "sent":
            // 202: accepted for delivery. Arrival is a later event, not this response.
            return result(202, {
              status: "accepted",
              notificationId,
              messageId: sent.messageId,
            });
          case "duplicate":
            return result(200, { status: "duplicate", notificationId, state: sent.state });
          case "suppressed":
            return result(200, { status: "suppressed", notificationId, reason: sent.reason });
          case "conflict":
            return failure(
              409,
              "idempotency_conflict",
              "This notificationId was used for a different mail.",
              context,
            );
          case "rejected":
            deps.log({
              level: "warn",
              message: "send rejected",
              requestId: context.requestId,
              notificationId,
              reason: sent.reason,
            });
            return failure(
              502,
              "send_rejected",
              "The mail was refused and not sent. The same request may be retried.",
              context,
            );
          case "unknown":
            return failure(
              502,
              "send_unknown",
              "It is not known whether the mail was sent. Retrying this notificationId will not send it again.",
              context,
            );
        }
      }),
      route("GET", "/share-notifications/:id", async (_request, context, { id = "" }) => {
        const record = await deps.notify.store.get(id);
        if (record === undefined) {
          return failure(404, "not_found", "No such notification.", context);
        }
        const { fingerprint: _fingerprint, expiresAt: _expiresAt, ...status } = record;
        return Response.json(status);
      }),
    ],
    (_request, context) => failure(404, "not_found", "No such route.", context),
  );

  // Everything that happens to every request, in the order it happens.
  return async (request) => {
    const context = { requestId: deps.newRequestId() };
    const startedAt = deps.now();
    let response: Response;
    try {
      response = await routes(request, context);
    } catch (error) {
      // The stack trace goes to the log, never to the caller.
      deps.log({
        level: "error",
        message: "unhandled error",
        requestId: context.requestId,
        error: error instanceof Error ? error.stack : String(error),
      });
      response = failure(500, "internal", "The request could not be completed.", context);
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
}
// #endregion app
