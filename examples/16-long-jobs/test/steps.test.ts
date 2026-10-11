import { describe, expect, it } from "vite-plus/test";
import { ExportCorruptError, manifestKey, partKey, toProgress } from "../src/job.ts";
import { atMostPages, discardExport, exportPages, finishExport } from "../src/steps.ts";
import { everyPage, ID, ids, range, setup, START } from "./harness.ts";

const begin = () => toProgress(START);

describe("an export that nothing interrupts", () => {
  it("writes every note once, in parts, and a manifest that names them", async () => {
    const t = setup(25);
    const progress = await exportPages(t.deps, begin(), everyPage(10));
    expect(progress).toEqual({ exportId: ID, cursor: null, nextPart: 4, notes: 25, done: true });
    // Parts alone are not an export: nothing is readable before the manifest.
    expect(t.read()).toBeUndefined();

    const finished = await finishExport(t.deps, progress);
    expect(finished).toEqual({ exportId: ID, manifestKey: manifestKey(ID), parts: 3, notes: 25 });
    expect(ids(t.read())).toEqual(range(1, 25));
  });

  it("finishes an empty table with a manifest and no parts", async () => {
    const t = setup(0);
    const progress = await exportPages(t.deps, begin(), everyPage(10));
    expect(progress).toMatchObject({ nextPart: 1, notes: 0, done: true });
    await finishExport(t.deps, progress);
    expect(t.read()).toEqual([]);
  });

  it("gives the same output whatever the checkpoint size", async () => {
    const coarse = setup(25);
    await finishExport(coarse.deps, await exportPages(coarse.deps, begin(), everyPage(10)));

    const fine = setup(25);
    let progress = begin();
    let calls = 0;
    while (!progress.done) {
      progress = await exportPages(fine.deps, progress, { pageSize: 10, mayContinue: atMostPages(1) });
      calls += 1;
    }
    await finishExport(fine.deps, progress);

    expect(calls).toBe(3);
    expect(fine.read()).toEqual(coarse.read());
  });
});

describe("a step that runs again", () => {
  it("changes nothing when the same step is delivered twice", async () => {
    const t = setup(25);
    const first = await exportPages(t.deps, begin(), everyPage(10));
    const second = await exportPages(t.deps, begin(), everyPage(10));
    expect(second).toEqual(first);
    expect(await t.parts()).toHaveLength(3);
  });

  it("continues where the first attempt stopped, even if the table changed in between", async () => {
    const t = setup(25);
    // The first attempt writes one part, and its answer never reaches the workflow.
    await exportPages(t.deps, begin(), { pageSize: 10, mayContinue: atMostPages(1) });
    // Meanwhile a note from that part is deleted, so a fresh read of page one ends one note later.
    t.source.remove("alice", "n0003");

    const retried = await exportPages(t.deps, begin(), everyPage(10));
    await finishExport(t.deps, retried);

    // Part one is the first attempt's, deleted note included. Nothing after it is skipped or repeated.
    expect(ids(t.read())).toEqual(range(1, 25));
    expect(retried.notes).toBe(25);
  });

  it("picks up after a crash in the middle of a call", async () => {
    const t = setup(45);
    // Two parts are written, the third write fails, and the call throws without returning progress.
    t.failStoreAfter("putIfAbsent", 2);
    await expect(exportPages(t.deps, begin(), everyPage(10))).rejects.toThrow("injected failure");
    expect(await t.parts()).toEqual([partKey(ID, 1), partKey(ID, 2)]);

    const retried = await exportPages(t.deps, begin(), everyPage(10));
    await finishExport(t.deps, retried);
    expect(ids(t.read())).toEqual(range(1, 45));
  });

  it("does not advance when reading the notes fails", async () => {
    const t = setup(25);
    t.failSourceAfter("page", 1);
    await expect(exportPages(t.deps, begin(), everyPage(10))).rejects.toThrow("injected failure");
    expect(await t.parts()).toEqual([partKey(ID, 1)]);
  });
});

describe("two workers on the same export", () => {
  it("keeps the first writer's part when a stalled worker wakes up late", async () => {
    const t = setup(25);
    // Worker A has read page one and is about to write it when it stalls.
    const hold = t.holdStore("putIfAbsent");
    const stalled = exportPages(t.deps, begin(), { pageSize: 10, mayContinue: atMostPages(1) });
    await hold.reached;

    // The workflow gives up on A. A note A is holding gets deleted, and worker B does the whole export.
    t.source.remove("alice", "n0003");
    const afterPartOne = await exportPages(t.deps, begin(), { pageSize: 10, mayContinue: atMostPages(1) });
    await finishExport(t.deps, await exportPages(t.deps, afterPartOne, everyPage(10)));
    const before = t.read();
    expect(ids(before)).toEqual([...range(1, 2), ...range(4, 25)]);

    // A wakes up with a page that still has the deleted note, and one note fewer after it.
    hold.release();
    const late = await stalled;

    expect(t.read()).toEqual(before);
    // A reports what is stored, not what it meant to write: it would continue exactly where B did.
    expect(late).toEqual(afterPartOne);
  });

  it("produces one export when two runs of the same export overlap", async () => {
    const t = setup(45);
    const run = async () => {
      let progress = begin();
      while (!progress.done) {
        progress = await exportPages(t.deps, progress, { pageSize: 10, mayContinue: atMostPages(1) });
      }
      return finishExport(t.deps, progress);
    };
    const [first, second] = await Promise.all([run(), run()]);
    expect(second).toEqual(first);
    expect(await t.parts()).toHaveLength(5);
    expect(ids(t.read())).toEqual(range(1, 45));
  });
});

describe("finishing and discarding", () => {
  it("refuses to write a manifest that would name a missing part", async () => {
    const t = setup(25);
    const progress = await exportPages(t.deps, begin(), everyPage(10));
    await t.deps.store.delete(partKey(ID, 2));

    await expect(finishExport(t.deps, progress)).rejects.toThrow(ExportCorruptError);
    await expect(finishExport(t.deps, progress)).rejects.toMatchObject({ name: "ExportCorrupt" });
    expect(t.read()).toBeUndefined();
  });

  it("refuses to finish before the last page", async () => {
    const t = setup(25);
    const progress = await exportPages(t.deps, begin(), { pageSize: 10, mayContinue: atMostPages(1) });
    await expect(finishExport(t.deps, progress)).rejects.toThrow("still has pages");
  });

  it("is safe to finish twice", async () => {
    const t = setup(25);
    const progress = await exportPages(t.deps, begin(), everyPage(10));
    expect(await finishExport(t.deps, progress)).toEqual(await finishExport(t.deps, progress));
  });

  it("removes a half-written export, and can be interrupted and run again", async () => {
    const t = setup(25);
    await exportPages(t.deps, begin(), everyPage(10));
    // The second delete fails: one part is gone, two remain.
    t.failStoreAfter("delete", 1);
    await expect(discardExport(t.deps, { exportId: ID })).rejects.toThrow("injected failure");
    expect(await t.parts()).toHaveLength(2);

    expect(await discardExport(t.deps, { exportId: ID })).toEqual({ exportId: ID, removed: 2, kept: false });
    expect(await discardExport(t.deps, { exportId: ID })).toEqual({ exportId: ID, removed: 0, kept: false });
  });

  it("never discards an export that has its manifest", async () => {
    const t = setup(25);
    await finishExport(t.deps, await exportPages(t.deps, begin(), everyPage(10)));
    expect(await discardExport(t.deps, { exportId: ID })).toEqual({ exportId: ID, removed: 0, kept: true });
    expect(ids(t.read())).toEqual(range(1, 25));
  });
});

describe("what starts a run", () => {
  it("names the export after the time the schedule was due", () => {
    expect(toProgress({ exportId: "2026-10-12T03:00:00Z" })).toEqual({
      exportId: "2026-10-12T030000Z",
      cursor: null,
      nextPart: 1,
      notes: 0,
      done: false,
    });
  });

  it("rejects an ID that would leave the export's own prefix", () => {
    expect(() => toProgress({ exportId: "../other" })).toThrow();
    expect(() => toProgress({ exportId: "a/b" })).toThrow();
    expect(() => toProgress({})).toThrow();
  });

  it("does not take a damaged progress for a fresh start", () => {
    expect(() => toProgress({ exportId: ID, nextPart: 0, cursor: null, notes: 0, done: false })).toThrow();
  });
});
