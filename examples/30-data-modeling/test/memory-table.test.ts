import { describe, expect, it } from "vite-plus/test";

import { INDEX, INDEX_PK, INDEX_SK } from "../src/keys.ts";
import { memoryTable } from "./support.ts";
import { describeTableContract } from "./table-contract.ts";

describeTableContract("memory", async () => memoryTable());

const pk = "OWNER#u1";
const note = (sortKey: string, extra: object = {}) => ({
  pk,
  sk: "NOTE#a",
  [INDEX_PK]: pk,
  [INDEX_SK]: sortKey,
  title: "t",
  ...extra,
});

// What only the model can show: it is the one place where the index can be held back on purpose.
describe("MemoryTable: the index lags", () => {
  it("answers a query from before the write until it catches up", async () => {
    const table = memoryTable();
    table.pauseIndex();
    await table.write({ kind: "put", item: note("UPDATED#1#a") });

    const read = () => table.query({ index: INDEX, pk, sk: { beginsWith: "UPDATED#" } });
    expect((await read()).items).toEqual([]);
    // The table itself already has it.
    expect(await table.get({ pk, sk: "NOTE#a" })).toBeDefined();

    table.catchUp();
    expect((await read()).items).toHaveLength(1);
  });

  it("can still list an item that the table no longer has", async () => {
    const table = memoryTable();
    await table.write({ kind: "put", item: note("UPDATED#1#a") });
    table.pauseIndex();
    await table.write({ kind: "delete", key: { pk, sk: "NOTE#a" } });

    const listed = await table.query({ index: INDEX, pk });
    expect(listed.items).toHaveLength(1);
    expect(await table.get({ pk, sk: "NOTE#a" })).toBeUndefined();
  });
});

describe("MemoryTable: what a table write costs the index", () => {
  const cost = async (
    prepare: object | undefined,
    write: Parameters<ReturnType<typeof memoryTable>["write"]>[0],
  ) => {
    const table = memoryTable();
    if (prepare !== undefined) {
      await table.write({ kind: "put", item: { pk, sk: "NOTE#a", ...prepare } });
    }
    const before = table.usage.indexWrites;
    await table.write(write);
    return table.usage.indexWrites - before;
  };
  const key = { pk, sk: "NOTE#a" };

  it("one write to enter the index", async () => {
    expect(await cost(undefined, { kind: "put", item: note("UPDATED#1#a") })).toBe(1);
  });

  it("two when an index key changes: the old entry is deleted, a new one put", async () => {
    expect(
      await cost(note("UPDATED#1#a"), { kind: "update", key, set: { [INDEX_SK]: "UPDATED#2#a" } }),
    ).toBe(2);
  });

  it("one when only a projected attribute changes", async () => {
    expect(await cost(note("UPDATED#1#a"), { kind: "update", key, set: { title: "new" } })).toBe(1);
  });

  it("none when only an attribute outside the projection changes", async () => {
    expect(await cost(note("UPDATED#1#a"), { kind: "update", key, set: { body: "new" } })).toBe(0);
  });

  it("none for an item that is not in the index before or after", async () => {
    expect(await cost({ title: "t" }, { kind: "update", key, set: { title: "new" } })).toBe(0);
  });

  it("one to leave the index", async () => {
    expect(await cost(note("UPDATED#1#a"), { kind: "delete", key })).toBe(1);
  });
});

describe("MemoryTable: the stream", () => {
  it("records each change once, in order, and nothing for a write that changes nothing", async () => {
    const table = memoryTable();
    await table.write({ kind: "put", item: { pk, sk: "A", n: 1 } });
    await table.write({ kind: "put", item: { pk, sk: "A", n: 1 } });
    await table.write({ kind: "update", key: { pk, sk: "A" }, set: { n: 2 } });
    await table.write({ kind: "delete", key: { pk, sk: "A" } });
    await table.write({ kind: "delete", key: { pk, sk: "A" } });

    expect(table.stream.map((record) => record.eventName)).toEqual(["INSERT", "MODIFY", "REMOVE"]);
    expect(new Set(table.stream.map((record) => record.eventId)).size).toBe(3);
    const numbers = table.stream.map((record) => record.sequenceNumber);
    expect(numbers).toEqual(numbers.toSorted());
  });

  it("records nothing for a transaction that was cancelled", async () => {
    const table = memoryTable();
    await table.transact([
      { kind: "put", item: { pk, sk: "A" } },
      { kind: "check", key: { pk, sk: "MISSING" }, condition: { kind: "exists" } },
    ]);
    expect(table.stream).toEqual([]);
    // Billed all the same: both items were prepared.
    expect(table.usage.transactionalWrites).toBe(2);
  });
});
