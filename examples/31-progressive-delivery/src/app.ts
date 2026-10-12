import { cors } from "@aih/example-04-http-api/src/http/cors.ts";
import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";

import { seesNoteStats, writesAreStopped } from "./flags/evaluate.ts";
import type { FlagReading } from "./flags/reader.ts";

export type RolloutDeps = {
  /** Chapter 04's application, unchanged. Whatever this layer does not answer goes to it. */
  inner: Fetch;
  readFlags: () => Promise<FlagReading>;
  countNotes: () => Promise<number>;
  /** The Lambda version that is running. Every answer carries it. */
  version: string;
  allowedOrigin: string;
  faultPercent: number;
  random: () => number;
  newRequestId: () => string;
};

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// #region app
export function createRolloutApp(deps: RolloutDeps): Fetch {
  // Answers made here get the same CORS headers chapter 04 gives its own.
  const own = cors<Response>(
    {
      origin: deps.allowedOrigin,
      allowMethods: ["GET", "POST", "DELETE"],
      allowHeaders: ["content-type"],
    },
    (_request, response) => response,
  );
  const refuse = (request: Request, status: number, code: string, message: string) => {
    const requestId = deps.newRequestId();
    const response = Response.json({ error: { code, message, requestId } }, { status });
    response.headers.set("x-request-id", requestId);
    return own(request, response);
  };

  const answer = async (request: Request, reading: FlagReading): Promise<Response> => {
    // #region fault
    if (deps.random() * 100 < deps.faultPercent) {
      return refuse(request, 500, "internal", "The request could not be completed.");
    }
    // #endregion fault

    // #region read-only
    if (writesAreStopped(reading.flags) && WRITES.has(request.method)) {
      return refuse(
        request,
        503,
        "read_only",
        "Writes are switched off for now. Reads still work.",
      );
    }
    // #endregion read-only

    // #region stats
    const { pathname } = new URL(request.url);
    // The caller's ID stands in for the signed-in user of chapter 06. Without one, only a 100% rollout applies.
    const subject = request.headers.get("x-client-id") ?? undefined;
    if (
      request.method === "GET" &&
      pathname === "/stats" &&
      seesNoteStats(reading.flags, subject)
    ) {
      return own(request, Response.json({ notes: await deps.countNotes() }));
    }
    // With the flag off this falls through, and chapter 04 answers 404 as if the route had never been written.
    return deps.inner(request);
    // #endregion stats
  };

  return async (request) => {
    const reading = await deps.readFlags();
    const response = await answer(request, reading);
    // Which code answered, and what it knew about the flags when it did.
    response.headers.set("x-app-version", deps.version);
    response.headers.set("x-flags-origin", reading.origin);
    return response;
  };
}
// #endregion app
