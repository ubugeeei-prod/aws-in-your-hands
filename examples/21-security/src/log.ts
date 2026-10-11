const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

export type LogEntry = { level: Level; message: string } & Record<string, unknown>;
export type Logger = (entry: LogEntry) => void;

/** One JSON object per line. Callers pass version ids and error names, never key material or tokens. */
export function createLogger(minimum: Level, write: (line: string) => void = console.log): Logger {
  return (entry) => {
    if (LEVELS.indexOf(entry.level) >= LEVELS.indexOf(minimum)) {
      write(JSON.stringify(entry));
    }
  };
}
