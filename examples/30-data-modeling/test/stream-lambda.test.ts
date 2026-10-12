import { describe, expect, it } from "vite-plus/test";

import { createNotebook } from "../src/notebook.ts";
import { createHandler, toChange } from "../src/stream-lambda.ts";
import { memoryTable } from "./support.ts";

// The shape of the example event in the Lambda developer guide, with this table's keys.
const record = (eventName: string, sk: string, sequence: string) => ({
  eventID: `id-${sequence}`,
  eventVersion: "1.1",
  eventSource: "aws:dynamodb",
  awsRegion: "ap-northeast-1",
  eventName,
  eventSourceARN:
    "arn:aws:dynamodb:ap-northeast-1:111122223333:table/t/stream/2026-10-13T00:00:00.000",
  dynamodb: {
    ApproximateCreationDateTime: 1791849600,
    Keys: { pk: { S: "OWNER#u1" }, sk: { S: sk } },
    SequenceNumber: sequence,
    SizeBytes: 26,
    StreamViewType: "KEYS_ONLY",
  },
});

function setup() {
  const table = memoryTable();
  const logged: Record<string, unknown>[] = [];
  const handler = createHandler({
    table,
    now: () => new Date("2026-10-13T00:00:00.000Z"),
    log: (entry) => logged.push(entry),
  });
  return { table, handler, logged, notebook: createNotebook({ table }) };
}

describe("stream handler", () => {
  it("turns a record into a change", () => {
    expect(toChange(record("INSERT", "TAG#trip#NOTE#n1", "100"))).toEqual({
      eventId: "id-100",
      eventName: "INSERT",
      sequenceNumber: "100",
      pk: "OWNER#u1",
      sk: "TAG#trip#NOTE#n1",
    });
  });

  it("counts the tags in a batch and reports no failures", async () => {
    const { handler, notebook, logged } = setup();
    const response = await handler({
      Records: [
        record("INSERT", "NOTE#n1", "100"),
        record("INSERT", "TAG#trip#NOTE#n1", "101"),
        record("INSERT", "TAG#trip#NOTE#n2", "102"),
        record("REMOVE", "TAG#trip#NOTE#n2", "103"),
      ],
    });
    expect(response).toEqual({ batchItemFailures: [] });
    expect(await notebook.tagCount("u1", "trip")).toBe(1);
    expect(logged).toEqual([
      { message: "projected", records: 4, applied: 3, duplicates: 0, failedAt: undefined },
    ]);
  });

  it("names the first record it could not apply by its sequence number", async () => {
    const { table, handler } = setup();
    table.conflictOnce();
    const response = await handler({
      Records: [
        record("INSERT", "TAG#trip#NOTE#n1", "100"),
        record("INSERT", "TAG#food#NOTE#n1", "101"),
      ],
    });
    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: "100" }] });
  });

  it("fails the batch on a record without keys, and applies none of it", async () => {
    const { handler, notebook } = setup();
    const broken = {
      ...record("INSERT", "TAG#food#NOTE#n1", "101"),
      dynamodb: { SequenceNumber: "101" },
    };
    await expect(
      handler({ Records: [record("INSERT", "TAG#trip#NOTE#n1", "100"), broken] }),
    ).rejects.toThrow("expected shape");
    expect(await notebook.tagCount("u1", "trip")).toBe(0);
  });
});
