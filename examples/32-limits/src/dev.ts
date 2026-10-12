import * as v from "valibot";

import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";
import { MemoryCounterStore } from "@aih/example-14-kv-cache/src/memory-store.ts";
import { createRateLimiter } from "@aih/example-14-kv-cache/src/rate-limit.ts";

import { composeApp } from "./compose.ts";
import { callerLimit, stageThrottle } from "./throttle.ts";

// An environment variable is text. "10" becomes 10; "fast" becomes NaN, which v.number() refuses.
const positive = v.pipe(v.string(), v.transform(Number), v.number(), v.gtValue(0));
const settings = v.parse(
  v.object({
    PORT: v.optional(v.pipe(positive, v.integer()), "8787"),
    STAGE_RATE: v.optional(positive, "10"),
    STAGE_BURST: v.optional(v.pipe(positive, v.integer()), "20"),
    CALLER_LIMIT: v.optional(v.pipe(positive, v.integer()), "50"),
  }),
  process.env,
);

// #region dev
const app = composeApp(process.env);
// One process, so counters in memory are the whole truth here. On Lambda they would not be.
const limiter = createRateLimiter(new MemoryCounterStore(), {
  limit: settings.CALLER_LIMIT,
  windowMs: 10_000,
  algorithm: "sliding",
});

// In the order a request meets them in AWS: the stage's throttle, then the caller's own limit.
const handler = stageThrottle(
  { ratePerSecond: settings.STAGE_RATE, burst: settings.STAGE_BURST },
  Date.now,
  callerLimit(limiter, Date.now, app),
);

nodeServer(handler).listen(settings.PORT, () => {
  console.log(
    `notes API on http://localhost:${settings.PORT} ` +
      `(everyone: ${settings.STAGE_RATE}/s, burst ${settings.STAGE_BURST}; ` +
      `one caller: ${settings.CALLER_LIMIT} per 10 s)`,
  );
});
// #endregion dev
