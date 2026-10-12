import { describe, expect, it } from "vite-plus/test";

import { vectorKey } from "../src/chunk.ts";
import { createSearch } from "../src/search.ts";
import type { VectorIndex } from "../src/vector-index.ts";
import { conceptEmbedder, CONCEPTS, keysIn, note, world } from "./helpers.ts";

async function twoOwners() {
  const w = world();
  await w.write("alice", note("a1", "release", "決済の結合テストを終える"));
  await w.write("alice", note("a2", "garage", "the car needs new tyres"));
  await w.write("bob", note("b1", "budget", "決済の手数料は社外に出さない"));
  await w.write("bob", note("b2", "trip", "rent an automobile at the airport"));
  return w;
}

const idsOf = (outcome: { passages: { noteId: string }[] }) =>
  outcome.passages.map((passage) => passage.noteId);

describe("search", () => {
  it("finds a note by a word it contains", async () => {
    const { search } = await twoOwners();
    const outcome = await search("alice", "結合テスト", 5);
    expect(idsOf(outcome)).toEqual(["a1"]);
    expect(outcome.passages[0]?.matched).toContain("words");
  });

  it("finds a note that shares no word with the query, through the index", async () => {
    const { search } = await twoOwners();
    const outcome = await search("alice", "automobile", 5);
    expect(outcome.passages[0]).toMatchObject({ noteId: "a2", matched: ["meaning"] });
  });

  it("puts a note both ways found ahead of one that only one way found", async () => {
    const { search } = await twoOwners();
    const outcome = await search("alice", "car", 5);
    expect(outcome.passages[0]).toMatchObject({ noteId: "a2", matched: ["words", "meaning"] });
  });
});

describe("a search never returns another owner's note", () => {
  it("when both owners wrote about the same thing", async () => {
    const { search } = await twoOwners();
    expect(idsOf(await search("alice", "決済", 10))).toEqual(["a1"]);
    expect(idsOf(await search("bob", "決済", 10))).toEqual(["b1"]);
    expect(idsOf(await search("carol", "決済", 10))).toEqual([]);
  });

  it("when the index ignores the owner filter", async () => {
    const { notes, index, embedder } = await twoOwners();
    const leaky: VectorIndex = {
      put: (entries) => index.put(entries),
      delete: (keys) => index.delete(keys),
      list: () => index.list(),
      // Answers as if every caller were bob.
      query: (query) => index.query({ ...query, owner: "bob" }),
    };
    const search = createSearch({ notes, embedder, index: leaky });
    const outcome = await search("alice", "automobile", 10);
    expect(idsOf(outcome)).toEqual([]);
    expect(outcome.dropped.foreign).toBeGreaterThan(0);
  });

  it("when an entry in the index names the caller as owner of someone else's note", async () => {
    const { search, index } = await twoOwners();
    await index.put([
      {
        key: vectorKey("alice", "b2", 0),
        vector: CONCEPTS.automobile,
        owner: "alice",
        noteId: "b2",
        version: 1,
        passage: 0,
      },
    ]);
    const outcome = await search("alice", "automobile", 10);
    expect(idsOf(outcome)).toEqual(["a2"]);
    expect(outcome.dropped.stale).toBe(1);
  });

  it("for any index content, with a fixed seed", async () => {
    const { notes, embedder } = await twoOwners();
    // A small generator with a fixed seed: the same "random" index on every run.
    let state = 42;
    const random = () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)] as T;
    for (let round = 0; round < 200; round += 1) {
      const garbage: VectorIndex = {
        put: async () => {},
        delete: async () => {},
        async *list() {},
        query: async () =>
          Array.from({ length: 8 }, (_, position) => ({
            key: `k${position}`,
            distance: random(),
            owner: pick(["alice", "bob", "carol", ""]),
            noteId: pick(["a1", "a2", "b1", "b2", "zz"]),
            version: pick([1, 2]),
            passage: pick([0, 1, 99]),
          })),
      };
      const search = createSearch({ notes, embedder, index: garbage });
      for (const owner of ["alice", "bob"]) {
        const prefix = owner.charAt(0);
        const outcome = await search(owner, "anything", 10);
        expect(outcome.passages.every((passage) => passage.noteId.startsWith(prefix))).toBe(true);
      }
    }
  });
});

describe("when the index and the table disagree", () => {
  it("does not return a deleted note whose vector is still there", async () => {
    const { search, notes, index } = await twoOwners();
    // The delete reached the table. The stream record has not been applied yet.
    await notes.delete("alice", "a2");
    expect(await keysIn(index)).toContain("alice/a2/0@1");
    const outcome = await search("alice", "automobile", 10);
    expect(idsOf(outcome)).toEqual([]);
    expect(outcome.dropped.stale).toBe(1);
  });

  it("finds an edited note by its new words before the index has caught up", async () => {
    const { search, notes } = await twoOwners();
    await notes.update("alice", "a2", {
      title: "garage",
      body: "sold it, bought a bicycle",
      expectedVersion: 1,
      updatedAt: "2026-10-13T01:00:00.000Z",
    });
    // The words come from the table, so they are current.
    expect(idsOf(await search("alice", "bicycle", 10))).toEqual(["a2"]);
    // The vector is of version 1 and says "car". It is not believed.
    const byOldMeaning = await search("alice", "automobile", 10);
    expect(idsOf(byOldMeaning)).toEqual([]);
    expect(byOldMeaning.dropped.stale).toBe(1);
  });

  it("answers from the words alone when the embedding model fails", async () => {
    const base = await twoOwners();
    const failing = conceptEmbedder(CONCEPTS);
    failing.embed = () => Promise.reject(new Error("ThrottlingException"));
    const search = createSearch({ notes: base.notes, embedder: failing, index: base.index });
    const outcome = await search("alice", "決済", 10);
    expect(outcome.meaning).toBe("unavailable");
    expect(idsOf(outcome)).toEqual(["a1"]);
  });
});
