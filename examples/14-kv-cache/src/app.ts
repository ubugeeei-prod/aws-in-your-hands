import { type Handler, route, router } from "@aih/example-04-http-api/src/http/router.ts";

import { type Caller, rateSubject } from "./caller.ts";
import type { ItemSource } from "./catalog.ts";
import type { ErrorBody, Item, ItemList } from "./contract.ts";
import type { Env } from "./env.ts";
import type { Logger } from "./log.ts";
import type { RateLimiter } from "./rate-limit.ts";
import type { ReadThrough } from "./read-through.ts";

export type AppDeps = {
  env: Pick<Env, "STAGE" | "KV_STORE" | "RATE_ON_ERROR">;
  limiter: RateLimiter;
  source: ItemSource;
  cache: ReadThrough<Item[]>;
  log: Logger;
  newRequestId: () => string;
  now: () => number;
};

/** What every route sees besides the request. */
type Context = Caller & { requestId: string };

const failure = (
  status: number,
  code: ErrorBody["error"]["code"],
  message: string,
  { requestId }: Context,
) => Response.json({ error: { code, message, requestId } } satisfies ErrorBody, { status });

/** `caller` comes from the platform: the Lambda handler and the development server each fill it in. */
export function createApp(deps: AppDeps): Handler<Caller> {
  // #region limit
  // Wraps a route. The request reaches `next` only while its caller has budget left.
  const limited =
    (next: Handler<Context>): Handler<Context> =>
    async (request, context) => {
      // Counted by where the request came from. A header would be the caller's own choice.
      const subject = rateSubject(context.sourceAddress);
      let decision;
      try {
        decision = await deps.limiter.hit(subject, deps.now());
      } catch (error) {
        // The counter store is down. Which way to fail is a product decision, so it is a setting.
        // "allow" leaves the stage throttle in front of the API as the only limit.
        deps.log({
          level: "error",
          message: "rate limiter failed",
          requestId: context.requestId,
          error: String(error),
        });
        return deps.env.RATE_ON_ERROR === "deny"
          ? failure(503, "unavailable", "The rate limiter is unavailable.", context)
          : next(request, context);
      }
      const response = decision.allowed
        ? await next(request, context)
        : failure(429, "rate_limited", "Too many requests.", context);
      response.headers.set("ratelimit-limit", String(decision.limit));
      response.headers.set("ratelimit-remaining", String(decision.remaining));
      if (!decision.allowed) {
        response.headers.set("retry-after", String(decision.retryAfterSeconds));
      }
      return response;
    };
  // #endregion limit

  const routes = router<Context>(
    [
      route("GET", "/health", () =>
        Response.json({ status: "ok", stage: deps.env.STAGE, store: deps.env.KV_STORE }),
      ),
      // #region items
      route(
        "GET",
        "/items",
        limited(async () => {
          const loaded = await deps.cache.get("items", () => deps.source.list());
          const body: ItemList = {
            items: loaded.value,
            loadedAt: new Date(loaded.loadedAt).toISOString(),
          };
          return Response.json(body, {
            headers: {
              "x-cache": loaded.source === "cache" ? "hit" : "miss",
              // How stale this answer may be, in seconds.
              age: String(Math.max(0, Math.floor((deps.now() - loaded.loadedAt) / 1000))),
            },
          });
        }),
      ),
      // #endregion items
    ],
    (_request, context) => failure(404, "not_found", "No such route.", context),
  );

  // Everything that happens to every request, in the order it happens.
  return async (request, caller) => {
    const context = { ...caller, requestId: deps.newRequestId() };
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
      cache: response.headers.get("x-cache"),
      durationMs: deps.now() - startedAt,
    });
    return response;
  };
}

export type App = ReturnType<typeof createApp>;
