import type { NodeContext } from "@aih/example-04-http-api/src/http/node-server.ts";
import type { Handler } from "@aih/example-04-http-api/src/http/router.ts";
import { rateSubject } from "@aih/example-14-kv-cache/src/caller.ts";
import type { RateLimiter } from "@aih/example-14-kv-cache/src/rate-limit.ts";

import { type BucketPolicy, fullBucket, take } from "./token-bucket.ts";

// #region stage
/**
 * Stands in, on a laptop, for the throttle of an API Gateway stage: one bucket for everybody.
 * The body is this file's own; what API Gateway writes in a 429 was not confirmed.
 */
export function stageThrottle<Context>(
  policy: BucketPolicy,
  now: () => number,
  next: Handler<Context>,
): Handler<Context> {
  let state = fullBucket(policy, now());
  return (request, context) => {
    const taken = take(state, policy, now());
    state = taken.state;
    return taken.allowed
      ? next(request, context)
      : Response.json({ message: "Too Many Requests" }, { status: 429 });
  };
}
// #endregion stage

// #region caller
/** Chapter 14's limiter in front of the app: one caller cannot use up everyone's share. */
export function callerLimit(
  limiter: RateLimiter,
  now: () => number,
  next: Handler<NodeContext>,
): Handler<NodeContext> {
  return async (request, context) => {
    const decision = await limiter.hit(rateSubject(context.remoteAddress), now());
    if (decision.allowed) {
      return next(request, context);
    }
    return Response.json(
      { error: { code: "rate_limited", message: "Too many requests from this caller." } },
      // Unlike the stage throttle, this limit knows when the caller may come back.
      { status: 429, headers: { "retry-after": String(decision.retryAfterSeconds) } },
    );
  };
}
// #endregion caller
