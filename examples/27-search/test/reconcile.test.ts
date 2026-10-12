import { describe, expect, it } from "vite-plus/test";

import type { Note } from "@aih/example-05-dynamodb/src/contract.ts";

import { planReconcile, reindexNote } from "../src/reconcile.ts";
import { keysIn, note, world } from "./helpers.ts";

const entry = (key: string, version: number) => {
  const [owner = "", noteId = "", passage = "0"] = key.split("/");
  return { key, owner, noteId, version, passage: Number(passage) };
};

describe("planReconcile", () => {
  const notes = [
    { owner: "alice", note: note("a1", "t", "car") },
    { owner: "alice", note: note("a2", "t", "x".repeat(1_000), 3) },
  ];

  it("asks for nothing when the index holds exactly what the table implies", () => {
    const entries = [entry("alice/a1/0", 1), entry("alice/a2/0", 3), entry("alice/a2/1", 3)];
    expect(planReconcile(notes, entries)).toEqual({ reindex: [], remove: [] });
  });

  it("reindexes a note that is missing, incomplete, or indexed at another version", () => {
    expect(planReconcile(notes, []).reindex.map((item) => item.noteId)).toEqual(["a1", "a2"]);
    expect(planReconcile(notes, [entry("alice/a1/0", 1), entry("alice/a2/0", 3)]).reindex).toEqual([
      { owner: "alice", noteId: "a2" },
    ]);
    const old = [entry("alice/a1/0", 1), entry("alice/a2/0", 2), entry("alice/a2/1", 3)];
    expect(planReconcile(notes, old).reindex).toEqual([{ owner: "alice", noteId: "a2" }]);
  });

  it("removes vectors the table has no passage for", () => {
    const entries = [
      entry("alice/a1/0", 1),
      entry("alice/a2/0", 3),
      entry("alice/a2/1", 3),
      // A passage past the end of the note, a deleted note, and an entry that could not be read.
      entry("alice/a2/2", 3),
      entry("bob/b9/0", 1),
      { key: "junk", owner: "", noteId: "", version: 0, passage: 0 },
    ];
    expect(planReconcile(notes, entries)).toEqual({
      reindex: [],
      remove: ["alice/a2/2", "bob/b9/0", "junk"],
    });
  });
});

describe("reindexNote", () => {
  it("ends on the newest version when the stream indexes one in between", async () => {
    const { notes, index, indexer, write } = world();
    await write("alice", note("a1", "t", "car"));
    const v1 = (await notes.get("alice", "a1")) as Note;

    let reads = 0;
    const result = await reindexNote(
      {
        get: async (owner, id) => {
          reads += 1;
          if (reads === 1) {
            // The backfill reads version 1. Before it writes, the note is edited and the
            // stream indexes version 2.
            await notes.update(owner, id, {
              title: "t",
              body: "payment",
              expectedVersion: 1,
              updatedAt: "2026-10-13T01:00:00.000Z",
            });
            const v2 = (await notes.get(owner, id)) as Note;
            await indexer({ owner, noteId: id, before: v1, after: v2 });
            return v1;
          }
          return notes.get(owner, id);
        },
        indexer,
      },
      "alice",
      "a1",
    );
    expect(result).toBe("indexed");
    // Without the second read, version 1 would have been written over version 2 and stayed.
    expect(await keysIn(index)).toEqual(["alice/a1/0@2"]);
  });

  it("removes the vectors of a note that was deleted meanwhile", async () => {
    const { notes, index, indexer, write } = world();
    await write("alice", note("a1", "t", "car"));
    await notes.delete("alice", "a1");
    expect(await reindexNote({ get: (o, i) => notes.get(o, i), indexer }, "alice", "a1")).toBe(
      "gone",
    );
    expect(index.size).toBe(0);
  });

  it("gives up on a note that changes on every read, and says so", async () => {
    const { indexer } = world();
    let version = 0;
    const get = async () => note("a1", "t", "car", (version += 1));
    expect(await reindexNote({ get, indexer }, "alice", "a1", 3)).toBe("still_changing");
  });
});
