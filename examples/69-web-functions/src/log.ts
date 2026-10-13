import type { Env } from "@aih/example-04-http-api/src/env.ts";
import type { LogEntry, Logger } from "@aih/example-04-http-api/src/log.ts";

const LEVELS = ["debug", "info", "warn", "error"] as const;

export type Sink = Record<LogEntry["level"], (entry: unknown) => void>;

// #region logger
/**
 * Hands the entry to console as an object. Lambda writes an object as JSON under `message`,
 * and a string built with JSON.stringify as one escaped string that no query can look into.
 */
export function objectLogger(
  minimum: Env["LOG_LEVEL"],
  fields: Record<string, string>,
  sink: Sink = console,
): Logger {
  return (entry) => {
    if (LEVELS.indexOf(entry.level) >= LEVELS.indexOf(minimum)) {
      // console.error for an error: the revision's applicationLogLevel filters on the method used.
      sink[entry.level]({ ...entry, ...fields });
    }
  };
}
// #endregion logger
