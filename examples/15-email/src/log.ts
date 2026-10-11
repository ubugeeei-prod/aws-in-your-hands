const LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LEVELS)[number];

export type LogEntry = { level: LogLevel; message: string } & Record<string, unknown>;
export type Logger = (entry: LogEntry) => void;

/** One JSON object per line: greppable locally, queryable in CloudWatch Logs. */
export function createLogger(minimum: LogLevel, write: (line: string) => void = console.log): Logger {
  return (entry) => {
    if (LEVELS.indexOf(entry.level) >= LEVELS.indexOf(minimum)) {
      write(JSON.stringify(entry));
    }
  };
}
