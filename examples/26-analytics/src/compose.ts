import { randomUUID } from "node:crypto";

import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";
import { composeApp } from "@aih/example-05-dynamodb/src/compose.ts";
import { parseEnv } from "@aih/example-05-dynamodb/src/env.ts";
import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";

import { createMeasuredApp } from "./app.ts";
import type { Sink } from "./sink.ts";

// #region compose
export function composeMeasuredApp(source: Record<string, string | undefined>, sink: Sink): Fetch {
  const env = parseEnv(source);
  return createMeasuredApp({
    // The chapter 05 app as it is: its own log lines, its own request IDs.
    app: composeApp(source),
    sink,
    log: createLogger(env.LOG_LEVEL),
    newEventId: randomUUID,
    now: Date.now,
  });
}
// #endregion compose
