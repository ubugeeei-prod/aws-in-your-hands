import type { SQSEvent, SQSRecord } from "aws-lambda";
import { describe, expect, it } from "vite-plus/test";

import type { LogEntry } from "@aih/example-05-dynamodb/src/log.ts";

import { SOURCE } from "../src/contract.ts";
import { createCounterBatchHandler } from "../src/counter-queue.ts";
import { createCounter, InMemoryCounterStore } from "../src/counter.ts";
import { enrich } from "../src/shape.ts";
import { noteInserted, noteRemoved, OWNER } from "./fixtures.ts";

const message = (messageId: string, body: string) => ({ messageId, body }) as SQSRecord;
/** One event as the rule's queue target receives it: the whole bus event, as JSON. */
const delivered = (record: unknown, extra: Record<string, unknown> = {}) => {
  const [detail] = enrich([record]);
  return JSON.stringify({
    version: "0",
    id: "bus-event",
    source: SOURCE,
    "detail-type": detail?.type,
    time: "2026-10-12T00:00:00Z",
    account: "111122223333",
    region: "ap-northeast-1",
    resources: [],
    detail,
    ...extra,
  });
};

function setup() {
  const store = new InMemoryCounterStore();
  const lines: LogEntry[] = [];
  const handler = createCounterBatchHandler({
    count: createCounter(store),
    log: (entry) => void lines.push(entry),
  });
  return { store, lines, handler };
}

describe("the counter behind its queue", () => {
  it("counts a batch and reports nothing as failed", async () => {
    const { store, handler } = setup();
    const batch: SQSEvent = {
      Records: [
        message("m1", delivered(noteInserted("n1"))),
        message("m2", delivered(noteInserted("n2"))),
        message("m3", delivered(noteRemoved("n1"))),
      ],
    };
    expect(await handler(batch)).toEqual({ batchItemFailures: [] });
    expect(await store.get(OWNER)).toBe(1);
  });

  it("reports only the message it could not read, and counts the others", async () => {
    const { store, handler } = setup();
    const batch: SQSEvent = {
      Records: [
        message("m1", delivered(noteInserted("n1"))),
        message("m2", "not json"),
        message("m3", JSON.stringify({ detail: { type: "NoteCreated" } })),
        message("m4", delivered(noteInserted("n2"))),
      ],
    };
    expect(await handler(batch)).toEqual({
      batchItemFailures: [{ itemIdentifier: "m2" }, { itemIdentifier: "m3" }],
    });
    expect(await store.get(OWNER)).toBe(2);
  });

  it("an event counted before is a success, so it never reaches the dead-letter queue", async () => {
    const { store, lines, handler } = setup();
    const body = delivered(noteInserted("n1"));
    await handler({ Records: [message("m1", body)] });
    const again = await handler({
      Records: [message("m2", delivered(noteInserted("n1"), { "replay-name": "fix-1" }))],
    });
    expect(again).toEqual({ batchItemFailures: [] });
    expect(await store.get(OWNER)).toBe(1);
    expect(lines.at(-1)).toMatchObject({ status: "already_counted", replay: "fix-1" });
  });
});
