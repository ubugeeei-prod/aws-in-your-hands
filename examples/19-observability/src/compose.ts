import { randomBytes, randomUUID } from "node:crypto";
import { createRepository } from "@aih/example-05-dynamodb/src/compose.ts";
import { parseEnv } from "@aih/example-05-dynamodb/src/env.ts";
import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";
import { createObservedApp, type ObservedApp } from "./app.ts";

// #region compose
export function composeObservedApp(source: Record<string, string | undefined>): ObservedApp {
  const env = parseEnv(source);
  return createObservedApp({
    env,
    repository: createRepository(env),
    // One JSON object per event, with nothing before or after it. Under
    // Lambda's JSON log format, console.log passes such a line through as is.
    log: createLogger(env.LOG_LEVEL),
    newRequestId: randomUUID,
    now: Date.now,
    randomSuffix: () => randomBytes(5).toString("hex"),
  });
}
// #endregion compose
