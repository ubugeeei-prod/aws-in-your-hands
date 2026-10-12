import { describe, expect, it } from "vite-plus/test";

import { INDEX, INDEX_PK, INDEX_SK } from "../src/keys.ts";
import type { Item, SingleWrite, Table } from "../src/table.ts";
import { eventually, freshOwner } from "./support.ts";

// The rules the rest of the chapter stands on, written once and run against
// the memory model and, when it is running, DynamoDB Local.
export function describeTableContract(name: string, open: () => Promise<Table>) {
  const setup = async () => ({ table: await open(), pk: `OWNER#${freshOwner()}` });

  describe(`Table contract: ${name}`, () => {
    it("refuses a put when the key is taken, and keeps the first item", async () => {
      const { table, pk } = await setup();
      const first = {
        kind: "put",
        item: { pk, sk: "A", n: 1 },
        condition: { kind: "not_exists" },
      } as const;
      expect(await table.write(first)).toBe("ok");
      expect(await table.write({ ...first, item: { pk, sk: "A", n: 2 } })).toBe("condition_failed");
      expect(await table.get({ pk, sk: "A" }, { consistent: true })).toMatchObject({ n: 1 });
    });

    it("counts up to a limit and no further, with simultaneous writers", async () => {
      const { table, pk } = await setup();
      const take = () =>
        table.write({
          kind: "update",
          key: { pk, sk: "QUOTA" },
          add: { noteCount: 1 },
          condition: { kind: "missing_or_less_than", attribute: "noteCount", value: 3 },
        });
      const results = await Promise.all([take(), take(), take(), take(), take()]);
      expect(results.filter((result) => result === "ok")).toHaveLength(3);
      expect(await table.get({ pk, sk: "QUOTA" }, { consistent: true })).toMatchObject({
        noteCount: 3,
      });
    });

    it("sets, removes, and compares attributes whose names are reserved words", async () => {
      const { table, pk } = await setup();
      await table.write({ kind: "put", item: { pk, sk: "A", size: 1, name: "x", version: 1 } });
      const update: SingleWrite = {
        kind: "update",
        key: { pk, sk: "A" },
        set: { size: 2, version: 2 },
        remove: ["name"],
        condition: { kind: "equals", attribute: "version", value: 1 },
      };
      expect(await table.write(update)).toBe("ok");
      expect(await table.write(update)).toBe("condition_failed");
      const item = await table.get({ pk, sk: "A" }, { consistent: true });
      expect(item).toMatchObject({ size: 2, version: 2 });
      expect(item).not.toHaveProperty("name");
    });

    it("writes every item of a transaction or none, and says which condition failed", async () => {
      const { table, pk } = await setup();
      await table.write({ kind: "put", item: { pk, sk: "TAKEN" } });
      const result = await table.transact([
        { kind: "put", item: { pk, sk: "NEW" }, condition: { kind: "not_exists" } },
        { kind: "put", item: { pk, sk: "TAKEN" }, condition: { kind: "not_exists" } },
        { kind: "update", key: { pk, sk: "COUNT" }, add: { n: 1 } },
      ]);
      expect(result).toEqual({ ok: false, reasons: ["none", "condition_failed", "none"] });
      expect(await table.get({ pk, sk: "NEW" }, { consistent: true })).toBeUndefined();
      expect(await table.get({ pk, sk: "COUNT" }, { consistent: true })).toBeUndefined();
    });

    it("lets a transaction depend on an item it does not change", async () => {
      const { table, pk } = await setup();
      const attach = () =>
        table.transact([
          { kind: "check", key: { pk, sk: "NOTE#a" }, condition: { kind: "exists" } },
          { kind: "put", item: { pk, sk: "NOTE#a#ATTACHMENT#1" } },
        ]);
      expect(await attach()).toEqual({ ok: false, reasons: ["condition_failed", "none"] });
      await table.write({ kind: "put", item: { pk, sk: "NOTE#a" } });
      expect(await attach()).toEqual({ ok: true });
    });

    it("refuses a transaction that names one item twice", async () => {
      const { table, pk } = await setup();
      await expect(
        table.transact([
          { kind: "check", key: { pk, sk: "A" }, condition: { kind: "not_exists" } },
          { kind: "put", item: { pk, sk: "A" } },
        ]),
      ).rejects.toThrow();
    });

    it("refuses a transaction of more than 100 items", async () => {
      const { table, pk } = await setup();
      const writes = Array.from({ length: 101 }, (_, index) => ({
        kind: "put" as const,
        item: { pk, sk: `ITEM#${index}` },
      }));
      await expect(table.transact(writes)).rejects.toThrow();
      expect(await table.get({ pk, sk: "ITEM#0" }, { consistent: true })).toBeUndefined();
    });

    it("returns a note and what is stored under it, and not its neighbours", async () => {
      const { table, pk } = await setup();
      for (const sk of [
        "NOTE#a",
        "NOTE#a#ATTACHMENT#2",
        "NOTE#a#ATTACHMENT#1",
        "NOTE#ab",
        "NOTE#b",
        "MOTE#a",
      ]) {
        await table.write({ kind: "put", item: { pk, sk } });
      }
      const { items } = await table.query({
        pk,
        sk: { between: ["NOTE#a", "NOTE#a#~"] },
        consistent: true,
      });
      expect(items.map((item) => item.sk)).toEqual([
        "NOTE#a",
        "NOTE#a#ATTACHMENT#1",
        "NOTE#a#ATTACHMENT#2",
      ]);
    });

    it("pages through a prefix in descending order without loss or repeats", async () => {
      const { table, pk } = await setup();
      for (const sk of [
        "TAG#x#NOTE#1",
        "TAG#x#NOTE#2",
        "TAG#x#NOTE#3",
        "TAG#x#NOTE#4",
        "TAG#y#NOTE#9",
      ]) {
        await table.write({ kind: "put", item: { pk, sk } });
      }
      const seen: string[] = [];
      let after: Record<string, string> | undefined;
      let pages = 0;
      do {
        const page = await table.query({
          pk,
          sk: { beginsWith: "TAG#x#NOTE#" },
          descending: true,
          limit: 2,
          consistent: true,
          ...(after === undefined ? {} : { after }),
        });
        seen.push(...page.items.map((item) => item.sk));
        after = page.last;
        pages++;
      } while (after !== undefined);
      expect(seen).toEqual(["TAG#x#NOTE#4", "TAG#x#NOTE#3", "TAG#x#NOTE#2", "TAG#x#NOTE#1"]);
      // Four items in pages of two: the second page is full, so a third, empty one follows.
      expect(pages).toBe(3);
    });

    it("refuses a starting key that lies in another partition", async () => {
      const { table, pk } = await setup();
      await table.write({ kind: "put", item: { pk, sk: "NOTE#a" } });
      await expect(
        table.query({
          pk,
          sk: { beginsWith: "NOTE#" },
          after: { pk: `${pk}-other`, sk: "NOTE#a" },
        }),
      ).rejects.toThrow();
    });

    describe("the index", () => {
      const indexed = (
        pk: string,
        sk: string,
        sortKey: string,
        extra: Item | object = {},
      ): Item => ({
        pk,
        sk,
        [INDEX_PK]: pk,
        [INDEX_SK]: sortKey,
        ...extra,
      });
      const recent = (table: Table, pk: string, options: object = {}) =>
        table.query({
          index: INDEX,
          pk,
          sk: { beginsWith: "UPDATED#" },
          descending: true,
          ...options,
        });

      it("holds only the items that carry both of its key attributes", async () => {
        const { table, pk } = await setup();
        await table.write({ kind: "put", item: indexed(pk, "NOTE#a", "UPDATED#1#a") });
        await table.write({ kind: "put", item: { pk, sk: "NOTE#a#ATTACHMENT#1", [INDEX_PK]: pk } });
        await table.write({ kind: "put", item: { pk, sk: "TAG#x#NOTE#a" } });
        const page = await eventually(
          () => recent(table, pk),
          (result) => result.items.length > 0,
        );
        expect(page.items.map((item) => item.sk)).toEqual(["NOTE#a"]);
      });

      it("returns the projected attributes and nothing else", async () => {
        const { table, pk } = await setup();
        await table.write({
          kind: "put",
          item: indexed(pk, "NOTE#a", "UPDATED#1#a", { title: "t", body: "long text", version: 1 }),
        });
        const page = await eventually(
          () => recent(table, pk),
          (result) => result.items.length > 0,
        );
        expect(page.items[0]).toMatchObject({ title: "t", version: 1 });
        expect(page.items[0]).not.toHaveProperty("body");
      });

      it("moves an item when its index sort key changes", async () => {
        const { table, pk } = await setup();
        await table.write({ kind: "put", item: indexed(pk, "NOTE#a", "UPDATED#1#a") });
        await table.write({ kind: "put", item: indexed(pk, "NOTE#b", "UPDATED#2#b") });
        await table.write({
          kind: "update",
          key: { pk, sk: "NOTE#a" },
          set: { [INDEX_SK]: "UPDATED#3#a" },
        });
        const page = await eventually(
          () => recent(table, pk),
          (result) => result.items[0]?.sk === "NOTE#a",
        );
        expect(page.items.map((item) => item.sk)).toEqual(["NOTE#a", "NOTE#b"]);
      });

      it("pages with a key that names the table's keys and the index's", async () => {
        const { table, pk } = await setup();
        for (const id of ["a", "b", "c"]) {
          await table.write({ kind: "put", item: indexed(pk, `NOTE#${id}`, `UPDATED#1#${id}`) });
        }
        const first = await eventually(
          () => recent(table, pk, { limit: 2 }),
          (result) => result.items.length === 2,
        );
        expect(Object.keys(first.last ?? {}).toSorted()).toEqual([INDEX_PK, INDEX_SK, "pk", "sk"]);
        const second = await recent(table, pk, { limit: 2, after: first.last });
        expect([...first.items, ...second.items].map((item) => item.sk)).toEqual([
          "NOTE#c",
          "NOTE#b",
          "NOTE#a",
        ]);
        expect(second.last).toBeUndefined();
      });

      it("cannot be read consistently", async () => {
        const { table, pk } = await setup();
        await expect(recent(table, pk, { consistent: true })).rejects.toThrow();
      });
    });

    it("scans every item, a page at a time", async () => {
      const { table, pk } = await setup();
      const wanted = ["A", "B", "C", "D", "E"];
      for (const sk of wanted) {
        await table.write({ kind: "put", item: { pk, sk } });
      }
      const found: string[] = [];
      let after: { pk: string; sk: string } | undefined;
      do {
        const page = await table.scan({ limit: 2, ...(after === undefined ? {} : { after }) });
        found.push(...page.items.filter((item) => item.pk === pk).map((item) => item.sk));
        after = page.last;
      } while (after !== undefined);
      expect(found.toSorted()).toEqual(wanted);
    });
  });
}
