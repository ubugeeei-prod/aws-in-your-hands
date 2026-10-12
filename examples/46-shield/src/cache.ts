import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";

export type SharedCache = { path: string; maxAgeSeconds: number };

// #region cache
/**
 * Marks one route's successful GET as the same for every caller. CloudFront then answers
 * repeats itself. Only for a route that reads nothing about who is asking.
 */
export function withSharedCache(app: Fetch, cache: SharedCache): Fetch {
  return async (request) => {
    const response = await app(request);
    const shared =
      request.method === "GET" &&
      new URL(request.url).pathname === cache.path &&
      response.status === 200;
    // Everything else says so too: a missing header leaves the decision to a default TTL.
    response.headers.set(
      "cache-control",
      shared ? `public, max-age=${cache.maxAgeSeconds}` : "no-store",
    );
    return response;
  };
}
// #endregion cache
