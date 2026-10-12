import type { LogEntry } from "@aih/example-05-dynamodb/src/log.ts";

import { createBatchHandler } from "./consumer.ts";
import { InMemoryHistoryStore } from "./history.ts";
import { type Handler, LocalPoller, type MappingSettings } from "./local-poller.ts";
import { LocalStream, type Position } from "./local-stream.ts";
import type { StreamWriter } from "./producer.ts";
import { CONSUMER, STREAM } from "./settings.ts";

// #region local
/** A stream, a clock, and the deployed consumer's code over an in-memory store. No AWS. */
export function createLocal(options: { shards?: number; start?: number } = {}) {
  let clock = options.start ?? Date.UTC(2026, 9, 13);
  const now = () => new Date(clock);
  const stream = new LocalStream({
    shards: options.shards ?? STREAM.shards,
    now,
    retentionHours: STREAM.retentionHours,
  });
  const writer: StreamWriter = { putRecords: async (entries) => stream.putRecords(entries) };

  /** A consumer of its own: a store, the handler, and a mapping that reads for it. */
  const consumer = (
    overrides: {
      settings?: Partial<MappingSettings>;
      mode?: "guarded" | "blind";
      startingPosition?: Position;
      parentsFirst?: boolean;
      wrap?: (handler: Handler) => Handler;
    } = {},
  ) => {
    const store = new InMemoryHistoryStore();
    const logs: LogEntry[] = [];
    const handler: Handler = createBatchHandler({
      store,
      log: (entry) => logs.push(entry),
      ...(overrides.mode === undefined ? {} : { mode: overrides.mode }),
    });
    const poller = new LocalPoller({
      stream,
      handler: overrides.wrap?.(handler) ?? handler,
      settings: { ...CONSUMER, ...overrides.settings },
      now,
      ...(overrides.startingPosition === undefined
        ? {}
        : { startingPosition: overrides.startingPosition }),
      ...(overrides.parentsFirst === undefined ? {} : { parentsFirst: overrides.parentsFirst }),
    });
    return { store, logs, poller };
  };

  return {
    now,
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
    stream,
    writer,
    consumer,
  };
}
// #endregion local
