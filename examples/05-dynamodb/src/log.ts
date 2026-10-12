import type { Env } from "./env.ts";

const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

export type LogEntry = { level: Level; message: string } & Record<string, unknown>;
export type Logger = (entry: LogEntry) => void;

// #region logger
// One JSON object per line, so CloudWatch Logs Insights can filter on the fields.
export function createLogger(
  minimum: Env["LOG_LEVEL"],
  write: (line: string) => void = console.log,
): Logger {
  return (entry) => {
    if (LEVELS.indexOf(entry.level) >= LEVELS.indexOf(minimum)) {
      write(JSON.stringify(entry));
    }
  };
}
// #endregion logger
