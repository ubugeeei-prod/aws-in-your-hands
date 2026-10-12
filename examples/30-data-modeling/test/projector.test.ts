import { describe, expect, it } from "vite-plus/test";

import { appliedSk, ownerPk, tagCountSk, TTL_ATTRIBUTE } from "../src/keys.ts";
import type { MemoryTable } from "../src/memory-table.ts";
import { createNotebook } from "../src/notebook.ts";
import { type Change, MARKER_TTL_SECONDS, project, tagDelta } from "../src/projector.ts";
import { change, memoryTable, note } from "./support.ts";

const OWNER = "u1";
const NOW = new Date("2026-10-13T00:00:00.000Z");

const changesFrom = (table: MemoryTable, from = 0): Change[] =>
  table.stream.slice(from).map((record) => ({
    eventId: record.eventId,
    sequenceNumber: record.sequenceNumber,
    eventName: record.eventName,
    ...record.keys,
  }));

function setup() {
  const table = memoryTable();
  return { table, notebook: createNotebook({ table }) };
}

describe("tagDelta", () => {
  const base = { eventId: "e", sequenceNumber: "1", pk: ownerPk(OWNER) };

  it("counts a tag item appearing and disappearing, and nothing else", () => {
    expect(tagDelta({ ...base, eventName: "INSERT", sk: "TAG#trip#NOTE#n1" })).toEqual({
      tag: "trip",
      delta: 1,
    });
    expect(tagDelta({ ...base, eventName: "REMOVE", sk: "TAG#trip#NOTE#n1" })?.delta).toBe(-1);
    // A new title rewrites the tag item. The note still has the tag.
    expect(tagDelta({ ...base, eventName: "MODIFY", sk: "TAG#trip#NOTE#n1" })).toBeUndefined();
    for (const sk of ["NOTE#n1", "QUOTA", tagCountSk("trip"), appliedSk("event-1")]) {
      expect(tagDelta({ ...base, eventName: "INSERT", sk })).toBeUndefined();
    }
  });
});

describe("projector", () => {
  it("is behind the table until it has read the stream", async () => {
    const { table, notebook } = setup();
    await notebook.create(OWNER, note("n1", { tags: ["trip"] }));
    await notebook.create(OWNER, note("n2", { tags: ["trip", "food"] }));
    expect(await notebook.tagCount(OWNER, "trip")).toBe(0);

    await project(table, changesFrom(table), NOW);
    expect(await notebook.tagCount(OWNER, "trip")).toBe(2);
    expect(await notebook.tagCount(OWNER, "food")).toBe(1);
  });

  it("follows tags added, removed, renamed around, and deleted with their note", async () => {
    const { table, notebook } = setup();
    await notebook.create(OWNER, note("n1", { tags: ["trip", "food"] }));
    await notebook.create(OWNER, note("n2", { tags: ["trip"] }));
    await notebook.update(OWNER, "n1", change(1, { title: "renamed", tags: ["trip", "work"] }));
    await notebook.remove(OWNER, "n2");

    await project(table, changesFrom(table), NOW);
    expect(await notebook.tagCount(OWNER, "trip")).toBe(1);
    expect(await notebook.tagCount(OWNER, "food")).toBe(0);
    expect(await notebook.tagCount(OWNER, "work")).toBe(1);
  });

  // Lambda delivers at least once: the same batch can arrive again after a timeout or a crash.
  it("counts a batch once however often it is delivered", async () => {
    const { table, notebook } = setup();
    await notebook.create(OWNER, note("n1", { tags: ["trip"] }));
    const batch = changesFrom(table);

    expect(await project(table, batch, NOW)).toMatchObject({ applied: 1, duplicates: 0 });
    expect(await project(table, batch, NOW)).toMatchObject({ applied: 0, duplicates: 1 });
    expect(await project(table, batch.toReversed(), NOW)).toMatchObject({
      applied: 0,
      duplicates: 1,
    });
    expect(await notebook.tagCount(OWNER, "trip")).toBe(1);
  });

  it("without the marker, the same redelivery counts twice", async () => {
    const { table, notebook } = setup();
    await notebook.create(OWNER, note("n1", { tags: ["trip"] }));
    const naive = async (batch: Change[]) => {
      for (const item of batch) {
        const counted = tagDelta(item);
        if (counted !== undefined) {
          await table.write({
            kind: "update",
            key: { pk: item.pk, sk: tagCountSk(counted.tag) },
            add: { count: counted.delta },
          });
        }
      }
    };
    const batch = changesFrom(table);
    await naive(batch);
    await naive(batch);
    expect(await notebook.tagCount(OWNER, "trip")).toBe(2);
  });

  it("does not feed on its own writes", async () => {
    const { table, notebook } = setup();
    await notebook.create(OWNER, note("n1", { tags: ["trip", "food"] }));

    // The counts and markers it writes are changes to the same table, so they come back on the stream.
    let cursor = 0;
    let rounds = 0;
    while (cursor < table.stream.length) {
      const batch = changesFrom(table, cursor);
      cursor = table.stream.length;
      await project(table, batch, NOW);
      rounds++;
    }
    expect(rounds).toBe(2);
    expect(await notebook.tagCount(OWNER, "trip")).toBe(1);
  });

  it("stops at a record it could not apply and names it, so the retry starts there", async () => {
    const { table, notebook } = setup();
    await notebook.create(OWNER, note("n1", { tags: ["a", "b", "c"] }));
    const batch = changesFrom(table).filter((item) => tagDelta(item) !== undefined);
    const second = batch[1];

    // Fails the transaction for the second tag.
    const flaky = {
      ...table,
      get: table.get.bind(table),
      transact: async (writes: Parameters<MemoryTable["transact"]>[0]) => {
        if (writes.some((write) => write.kind === "update" && write.key.sk === tagCountSk("b"))) {
          table.conflictOnce();
        }
        return table.transact(writes);
      },
    };
    const first = await project(flaky as never, batch, NOW);
    expect(first).toEqual({ applied: 1, duplicates: 0, failedAt: second?.sequenceNumber });

    // Lambda sends the batch again from the failed record. Sending all of it is as safe.
    expect(await project(table, batch, NOW)).toEqual({
      applied: 2,
      duplicates: 1,
      failedAt: undefined,
    });
    for (const tag of ["a", "b", "c"]) {
      expect(await notebook.tagCount(OWNER, tag)).toBe(1);
    }
  });

  it("gives each marker an expiry past the stream's 24 hours", async () => {
    const { table, notebook } = setup();
    await notebook.create(OWNER, note("n1", { tags: ["trip"] }));
    const [first] = changesFrom(table).filter((item) => tagDelta(item) !== undefined);
    await project(table, changesFrom(table), NOW);

    const marker = await table.get({ pk: ownerPk(OWNER), sk: appliedSk(first?.eventId ?? "") });
    expect(marker?.[TTL_ATTRIBUTE]).toBe(NOW.getTime() / 1000 + MARKER_TTL_SECONDS);
    expect(MARKER_TTL_SECONDS).toBeGreaterThan(24 * 60 * 60);
  });
});
