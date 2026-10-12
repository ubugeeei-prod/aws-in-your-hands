import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";

import type { Region } from "./regions.ts";

export type RegionalDeps = {
  /** Chapter 05's notes API, bound to the table copy in this Region. */
  app: Fetch;
  region: Region;
  /** "refuse": this Region answers reads and turns writes away until a person changes it. */
  writes: "accept" | "refuse";
  /** One cheap read from this Region's copy of the table. Rejects when it cannot be done. */
  probe: (signal: AbortSignal) => Promise<void>;
  probeTimeoutMs: number;
  /** A drill: the health check answers 503 while everything else keeps working. */
  failHealth?: boolean | undefined;
};

export const REGION_HEADER = "x-aih-region";
export const HEALTH_PATH = "/health/region";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// #region health
// What Route 53 asks. It must say 2xx within two seconds of connecting, so the
// probe gives up well before that and the answer is 503, not silence.
async function health(deps: RegionalDeps): Promise<Response> {
  const timeout = AbortSignal.timeout(deps.probeTimeoutMs);
  try {
    if (deps.failHealth === true) {
      throw new Error("failing on purpose");
    }
    await Promise.race([
      deps.probe(timeout),
      new Promise<never>((_, reject) =>
        timeout.addEventListener("abort", () => reject(new Error("probe timed out")), {
          once: true,
        }),
      ),
    ]);
    return Response.json({ status: "ok", region: deps.region, writes: deps.writes });
  } catch {
    // No detail: this endpoint is public, and the reason is in the function's log.
    return Response.json({ status: "unavailable", region: deps.region }, { status: 503 });
  }
}
// #endregion health

// #region regional
export function createRegionalApp(deps: RegionalDeps): Fetch {
  return async (request) => {
    const { pathname } = new URL(request.url);
    let response: Response;
    if (request.method === "GET" && pathname === HEALTH_PATH) {
      response = await health(deps);
    } else if (deps.writes === "refuse" && !SAFE_METHODS.has(request.method)) {
      response = Response.json(
        {
          error: {
            code: "read_only_region",
            message: "This Region is standing by and does not accept changes.",
          },
        },
        { status: 503, headers: { "retry-after": "30" } },
      );
    } else {
      response = await deps.app(request);
    }
    // A response built elsewhere may have immutable headers, so it is rebuilt.
    const headers = new Headers(response.headers);
    headers.set(REGION_HEADER, deps.region);
    return new Response(response.body, { status: response.status, headers });
  };
}
// #endregion regional
