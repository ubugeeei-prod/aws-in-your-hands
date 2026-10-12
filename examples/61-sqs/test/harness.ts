import type { LogEntry } from "@aih/example-05-dynamodb/src/log.ts";

import type { Command } from "../src/command.ts";
import { FifoQueue } from "../src/fifo-queue.ts";
import { type Ledger, MemoryLedger } from "../src/ledger.ts";
import { deliverOnce, type PolledRecord } from "../src/poller.ts";
import { toEntry } from "../src/producer.ts";
import { QUEUE } from "../src/settings.ts";
import { type BatchResponse, createFifoBatchHandler } from "../src/worker.ts";

export const VISIBILITY_MS = QUEUE.visibilityTimeoutSeconds * 1000;
export const MAX_RECEIVES = QUEUE.maxReceiveCount;
const MINUTE = 60 * 1000;

let counter = 0;
/** A command for alice's note n1 unless told otherwise. */
export function command(change: Command["change"], overrides: Partial<Command> = {}): Command {
  counter += 1;
  return {
    version: 1,
    commandId: `c${counter}`,
    owner: "alice",
    noteId: "n1",
    change,
    ...overrides,
  };
}
export const append = (line: string, overrides: Partial<Command> = {}): Command =>
  command({ type: "append", line }, overrides);
export const retitle = (title: string, overrides: Partial<Command> = {}): Command =>
  command({ type: "retitle", title }, overrides);

type Handler = (batch: { Records: PolledRecord[] }) => Promise<BatchResponse>;

/** A queue with its dead-letter queue, a ledger, the real worker, and a clock that only moves when told. */
export function setup(options: { ledger?: Ledger } = {}) {
  let now = Date.parse("2026-10-13T00:00:00.000Z");
  let ids = 0;
  const clock = { now: () => new Date(now), newId: () => `m${(ids += 1)}` };
  const deadLetters = new FifoQueue({ ...clock, visibilityTimeoutMs: VISIBILITY_MS });
  const queue = new FifoQueue({
    ...clock,
    visibilityTimeoutMs: VISIBILITY_MS,
    deadLetter: { queue: deadLetters, maxReceiveCount: MAX_RECEIVES },
  });
  const inner = options.ledger ?? new MemoryLedger();

  // Faults and pauses sit in front of the ledger's one atomic step, where a
  // network call would be.
  let failures = { after: 0, count: 0 };
  let gate: Promise<void> | undefined;
  const ledger: Ledger = {
    async apply(input) {
      if (gate !== undefined) {
        const waiting = gate;
        gate = undefined;
        await waiting;
      }
      if (failures.after > 0) {
        failures.after -= 1;
      } else if (failures.count > 0) {
        failures.count -= 1;
        throw new Error("the table is not answering");
      }
      return inner.apply(input);
    },
    get: (owner, noteId) => inner.get(owner, noteId),
  };

  const logs: LogEntry[] = [];
  const worker = createFifoBatchHandler({
    ledger,
    park: async (record, reason) => {
      deadLetters.send({
        body: record.body,
        groupId: record.attributes.MessageGroupId,
        deduplicationId: record.messageId,
      });
      logs.push({ level: "debug", message: "parked", reason });
    },
    log: (entry) => logs.push(entry),
  });

  return {
    queue,
    deadLetters,
    ledger,
    worker,
    logs,
    send: (input: Command) => {
      const entry = toEntry(input);
      return queue.send({
        body: entry.MessageBody,
        groupId: entry.MessageGroupId,
        deduplicationId: entry.MessageDeduplicationId,
      });
    },
    deliver: (handler: Handler = worker, batchSize = 10) => deliverOnce(queue, handler, batchSize),
    note: (noteId = "n1", owner = "alice") => inner.get(owner, noteId),
    advance: (ms: number) => {
      now += ms;
    },
    advanceMinutes: (minutes: number) => {
      now += minutes * MINUTE;
    },
    /** `count` calls to the ledger fail before they reach it, after letting `after` calls through. */
    failNext: (count: number, after = 0) => {
      failures = { after, count };
    },
    /** The next call to the ledger waits until the returned function is called. */
    pauseNext: (): (() => void) => {
      let release = (): void => {};
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    results: () =>
      logs.filter((entry) => entry.message === "command handled").map((entry) => entry["result"]),
  };
}
