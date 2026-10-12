import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";
import type { Logger } from "@aih/example-05-dynamodb/src/log.ts";

import { describeRequest } from "./describe.ts";
import { toLine } from "./record.ts";
import type { Sink } from "./sink.ts";

export type MeasuredDeps = {
  /** The app whose requests are recorded. It is called, never changed. */
  app: Fetch;
  sink: Sink;
  log: Logger;
  newEventId: () => string;
  now: () => number;
};

// #region app
// Around the notes app: one record per answered request. The answer never
// depends on whether the record could be written.
export function createMeasuredApp(deps: MeasuredDeps): Fetch {
  return async (request) => {
    const startedAt = deps.now();
    const response = await deps.app(request);
    const answeredAt = deps.now();
    try {
      const record = await describeRequest({
        request,
        response,
        eventId: deps.newEventId(),
        answeredAt: new Date(answeredAt),
        durationMs: answeredAt - startedAt,
      });
      // Awaited: after the handler returns, Lambda may freeze the process mid-send.
      await deps.sink(toLine(record));
    } catch (error) {
      // A lost record is a gap in a chart. A failed request is a user's problem.
      deps.log({
        level: "warn",
        message: "analytics record dropped",
        requestId: response.headers.get("x-request-id") ?? "unknown",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return response;
  };
}
// #endregion app
