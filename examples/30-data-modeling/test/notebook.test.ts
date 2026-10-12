import { describe, expect, it } from "vite-plus/test";

import { BusyError, createNotebook } from "../src/notebook.ts";
import type { Table } from "../src/table.ts";
import { describeNotebookContract } from "./notebook-contract.ts";
import { attachment, change, memoryTable, note } from "./support.ts";

describeNotebookContract("memory", async () => memoryTable());

const OWNER = "u1";

function setup() {
  const table = memoryTable();
  return { table, notebook: createNotebook({ table }) };
}

/** What one call wrote, in item writes. */
async function spent(table: ReturnType<typeof memoryTable>, run: () => Promise<unknown>) {
  const before = { ...table.usage };
  await run();
  return {
    reads: table.usage.reads - before.reads,
    writes: table.usage.writes - before.writes,
    transactionalWrites: table.usage.transactionalWrites - before.transactionalWrites,
    indexWrites: table.usage.indexWrites - before.indexWrites,
  };
}

describe("Notebook: what the index does to reads", () => {
  it("a new note is in its own collection at once, and in the recent list only later", async () => {
    const { table, notebook } = setup();
    table.pauseIndex();
    await notebook.create(OWNER, note("n1", { tags: ["trip"] }));

    expect(await notebook.getWithAttachments(OWNER, "n1")).toBeDefined();
    // Tag items live in the table, so the tag's list is not behind.
    expect((await notebook.listByTag(OWNER, "trip", { limit: 10 })).entries).toHaveLength(1);
    expect((await notebook.listRecent(OWNER, { limit: 10 })).notes).toEqual([]);

    table.catchUp();
    expect((await notebook.listRecent(OWNER, { limit: 10 })).notes).toHaveLength(1);
  });

  it("a deleted note can still be listed, and reading it then finds nothing", async () => {
    const { table, notebook } = setup();
    await notebook.create(OWNER, note("n1"));
    table.pauseIndex();
    await notebook.remove(OWNER, "n1");

    const listed = (await notebook.listRecent(OWNER, { limit: 10 })).notes;
    expect(listed.map((item) => item.id)).toEqual(["n1"]);
    expect(await notebook.getWithAttachments(OWNER, "n1")).toBeUndefined();
  });
});

describe("Notebook: what each operation costs", () => {
  it("reads a note with ten attachments in one request", async () => {
    const { table, notebook } = setup();
    await notebook.create(OWNER, note("n1"));
    for (let index = 0; index < 10; index++) {
      await notebook.attach(OWNER, attachment("n1", `a${index}`));
    }
    expect(await spent(table, () => notebook.getWithAttachments(OWNER, "n1"))).toMatchObject({
      reads: 1,
    });
  });

  it("create: the note, the counter and each tag in one transaction, one index write", async () => {
    const { table, notebook } = setup();
    const cost = await spent(table, () =>
      notebook.create(OWNER, note("n1", { tags: ["a", "b", "c"], slug: "s" })),
    );
    expect(cost).toMatchObject({ writes: 0, transactionalWrites: 6, indexWrites: 1 });
  });

  it("an edit that keeps title, tags and slug is one plain write, and two index writes", async () => {
    const { table, notebook } = setup();
    await notebook.create(OWNER, note("n1", { title: "t", tags: ["a", "b", "c"] }));
    const cost = await spent(table, () =>
      notebook.update(OWNER, "n1", change(1, { title: "t", tags: ["a", "b", "c"] })),
    );
    // The index is sorted by updatedAt, which every edit changes: delete the old entry, put the new one.
    expect(cost).toMatchObject({ writes: 1, transactionalWrites: 0, indexWrites: 2 });
  });

  it("a new title rewrites the copy beside every tag", async () => {
    const { table, notebook } = setup();
    await notebook.create(OWNER, note("n1", { title: "t", tags: ["a", "b", "c"] }));
    const cost = await spent(table, () =>
      notebook.update(OWNER, "n1", change(1, { title: "renamed", tags: ["a", "b", "c"] })),
    );
    expect(cost).toMatchObject({ writes: 0, transactionalWrites: 4, indexWrites: 2 });
  });

  it("an attachment costs the index nothing", async () => {
    const { table, notebook } = setup();
    await notebook.create(OWNER, note("n1"));
    const cost = await spent(table, () => notebook.attach(OWNER, attachment("n1", "a1")));
    expect(cost).toMatchObject({ transactionalWrites: 2, indexWrites: 0 });
  });
});

describe("Notebook: a transaction that collides", () => {
  it("is tried again, and written once", async () => {
    const { table, notebook } = setup();
    const waits: number[] = [];
    const busy = createNotebook({ table, backoff: async (attempt) => void waits.push(attempt) });
    table.conflictOnce();
    table.conflictOnce();

    expect(await busy.create(OWNER, note("n1", { tags: ["trip"] }))).toBe("created");
    expect(waits).toEqual([0, 1]);
    expect(await notebook.count(OWNER)).toBe(1);
  });

  it("gives up after three attempts with nothing written", async () => {
    const { table, notebook } = setup();
    for (let index = 0; index < 3; index++) {
      table.conflictOnce();
    }
    await expect(notebook.create(OWNER, note("n1", { tags: ["trip"] }))).rejects.toThrow(BusyError);
    expect(table.items()).toEqual([]);
  });
});

describe("Notebook: a delete that stops half way", () => {
  /** Lets `budget` plain writes through, then fails like a process that was killed. */
  function dyingAfter(table: Table, budget: number): Table {
    let left = budget;
    return {
      get: (key, options) => table.get(key, options),
      query: (input) => table.query(input),
      scan: (input) => table.scan(input),
      transact: (writes) => table.transact(writes),
      write: async (write) => {
        if (left-- <= 0) {
          throw new Error("killed");
        }
        return table.write(write);
      },
    };
  }

  it("leaves attachments without a note, and the next delete removes them", async () => {
    const { table, notebook } = setup();
    await notebook.create(OWNER, note("n1"));
    for (const id of ["a1", "a2", "a3"]) {
      await notebook.attach(OWNER, attachment("n1", id));
    }

    const dying = createNotebook({ table: dyingAfter(table, 1) });
    await expect(dying.remove(OWNER, "n1")).rejects.toThrow("killed");
    // The note is gone and counted out; two attachments are still stored.
    expect(await notebook.count(OWNER)).toBe(0);
    expect(table.items().filter((item) => item.sk.includes("#ATTACHMENT#"))).toHaveLength(2);
    // Nobody can read them, or add to them.
    expect(await notebook.getWithAttachments(OWNER, "n1")).toBeUndefined();
    expect(await notebook.attach(OWNER, attachment("n1", "a4"))).toBe("note_missing");

    expect(await notebook.remove(OWNER, "n1")).toBe(false);
    expect(table.items().filter((item) => item.sk.includes("#ATTACHMENT#"))).toEqual([]);
  });
});
