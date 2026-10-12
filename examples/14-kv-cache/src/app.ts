import { Hono } from "hono";

import type { ItemSource } from "./catalog.ts";
import { clientIdSchema, type ErrorBody, type Item, type ItemList } from "./contract.ts";
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

type Variables = { requestId: string };

const failure = (code: ErrorBody["error"]["code"], message: string, requestId: string) =>
  ({ error: { code, message, requestId } }) satisfies ErrorBody;

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
      cache: c.res.headers.get("x-cache"),
      durationMs: deps.now() - startedAt,
    });
  });

  app.onError((error, c) => {
    const requestId = c.get("requestId");
    deps.log({
      level: "error",
      message: "unhandled error",
      requestId,
      error: error instanceof Error ? error.stack : String(error),
    });
    return c.json(failure("internal", "The request could not be completed.", requestId), 500);
  });

  app.notFound((c) => c.json(failure("not_found", "No such route.", c.get("requestId")), 404));

  // #region limit
  app.use("/items", async (c, next) => {
    const requestId = c.get("requestId");
    const clientId = clientIdSchema.safeParse(c.req.header("x-client-id"));
    if (!clientId.success) {
      return c.json(failure("invalid_request", "Send an x-client-id header.", requestId), 400);
    }
    let decision;
    try {
      decision = await deps.limiter.hit(clientId.data, deps.now());
    } catch (error) {
      // The counter store is down. Which way to fail is a product decision,
      // so it is a setting and not something buried in a catch block.
      deps.log({ level: "error", message: "rate limiter failed", requestId, error: String(error) });
      if (deps.env.RATE_ON_ERROR === "deny") {
        return c.json(failure("unavailable", "The rate limiter is unavailable.", requestId), 503);
      }
      return next();
    }
    c.header("ratelimit-limit", String(decision.limit));
    c.header("ratelimit-remaining", String(decision.remaining));
    if (!decision.allowed) {
      c.header("retry-after", String(decision.retryAfterSeconds));
      return c.json(failure("rate_limited", "Too many requests.", requestId), 429);
    }
    return next();
  });
  // #endregion limit

  return (
    app
      .get("/health", (c) =>
        c.json({ status: "ok" as const, stage: deps.env.STAGE, store: deps.env.KV_STORE }),
      )
      // #region items
      .get("/items", async (c) => {
        const loaded = await deps.cache.get("items", () => deps.source.list());
        c.header("x-cache", loaded.source === "cache" ? "hit" : "miss");
        // How stale this answer may be, in seconds.
        c.header("age", String(Math.max(0, Math.floor((deps.now() - loaded.loadedAt) / 1000))));
        const body: ItemList = {
          items: loaded.value,
          loadedAt: new Date(loaded.loadedAt).toISOString(),
        };
        return c.json(body);
      })
    // #endregion items
  );
}

export type App = ReturnType<typeof createApp>;
