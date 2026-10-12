import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { listingSchema, planExecution } from "../src/plan.ts";
import { ARCHIVE_TASK, taskProblems } from "../src/task.ts";
import { key, taskWith, world } from "./world.ts";

describe("the plan for the archive task as the stack creates it", () => {
  it("copies what the archive lacks and what differs, and skips what is the same", () => {
    const { source, archive } = world();
    source.put(key("alice", "same"), "one");
    source.put(key("alice", "changed"), "new bytes");
    source.put(key("alice", "new"), "three");
    archive.put(key("alice", "same"), "one");
    archive.put(key("alice", "changed"), "old");

    const plan = planExecution(source.list(), archive.list(), ARCHIVE_TASK);

    expect(plan.transfer.map(({ key: k, reason }) => [k, reason])).toEqual([
      [key("alice", "changed"), "changed"],
      [key("alice", "new"), "new"],
    ]);
    expect(plan.skip).toEqual([{ key: key("alice", "same"), reason: "same" }]);
    expect(plan.bytes).toBe("new bytes".length + "three".length);
  });

  it("keeps in the archive what the source has deleted", () => {
    const { source, archive } = world();
    archive.put(key("alice", "gone"), "still here");

    expect(planExecution(source.list(), archive.list(), ARCHIVE_TASK).delete).toEqual([]);
  });

  it("compares bytes, not times: a copy made later than its source is still the same", () => {
    const { source, archive } = world();
    source.put(key("alice", "a"), "one");
    archive.put(key("alice", "a"), "one");

    expect(planExecution(source.list(), archive.list(), ARCHIVE_TASK).transfer).toEqual([]);
  });
});

describe("deletes", () => {
  it("removes from the destination what the source no longer has, when asked to", () => {
    const { source, archive } = world();
    source.put(key("alice", "kept"), "one");
    archive.put(key("alice", "kept"), "one");
    archive.put(key("alice", "gone"), "two");

    const plan = planExecution(
      source.list(),
      archive.list(),
      taskWith({ preserveDeletedFiles: "REMOVE" }),
    );

    expect(plan.delete).toEqual([key("alice", "gone")]);
  });

  it("an empty source listing deletes the whole destination", () => {
    const { archive } = world();
    archive.put(key("alice", "a"), "one");
    archive.put(key("bob", "b"), "two");

    const plan = planExecution([], archive.list(), taskWith({ preserveDeletedFiles: "REMOVE" }));

    expect(plan.delete).toHaveLength(2);
  });

  it("leaves alone what the filters keep out of the copy", () => {
    const { source, archive } = world();
    archive.put(key("alice", "a"), "one");
    archive.put(key("bob", "b"), "two");

    const plan = planExecution(
      source.list(),
      archive.list(),
      taskWith({ preserveDeletedFiles: "REMOVE" }, { excludes: "/u/bob" }),
    );

    expect(plan.delete).toEqual([key("alice", "a")]);
  });
});

describe("overwrites", () => {
  it("overwrites a destination object that was written after the source's, and says so", () => {
    const { source, archive } = world();
    source.put(key("alice", "a"), "from the app");
    archive.put(key("alice", "a"), "edited in the archive");

    const [transfer] = planExecution(source.list(), archive.list(), ARCHIVE_TASK).transfer;

    expect(transfer).toMatchObject({ reason: "changed", destinationNewer: true });
  });

  it("with OverwriteMode NEVER protects that write, and also holds back every later change", () => {
    const { source, archive } = world();
    archive.put(key("alice", "a"), "first copy");
    source.put(key("alice", "a"), "second upload");
    source.put(key("alice", "b"), "new");

    const plan = planExecution(source.list(), archive.list(), taskWith({ overwriteMode: "NEVER" }));

    expect(plan.skip).toEqual([{ key: key("alice", "a"), reason: "overwrite_never" }]);
    expect(plan.transfer.map((transfer) => transfer.key)).toEqual([key("alice", "b")]);
  });
});

describe("transfer mode", () => {
  it("ALL copies what is already identical", () => {
    const { source, archive } = world();
    source.put(key("alice", "a"), "one");
    archive.put(key("alice", "a"), "one");

    const plan = planExecution(source.list(), archive.list(), taskWith({ transferMode: "ALL" }));

    expect(plan.transfer).toMatchObject([{ key: key("alice", "a"), reason: "all" }]);
  });

  it("ALL cannot be combined with removing deleted files", () => {
    const task = taskWith({ transferMode: "ALL", preserveDeletedFiles: "REMOVE" });
    expect(taskProblems(task)).toHaveLength(1);
    expect(taskProblems(ARCHIVE_TASK)).toEqual([]);
  });
});

describe("filters", () => {
  it("copies only what an include filter names, minus what an exclude filter names", () => {
    const { source, archive } = world();
    source.put(key("alice", "a"), "one");
    source.put(key("alice", "b-draft"), "two");
    source.put(key("bob", "c"), "three");

    const plan = planExecution(
      source.list(),
      archive.list(),
      taskWith({}, { includes: "/u/alice", excludes: "*-draft" }),
    );

    expect(plan.transfer.map((transfer) => transfer.key)).toEqual([key("alice", "a")]);
    expect(plan.skip).toEqual([
      { key: key("alice", "b-draft"), reason: "excluded" },
      { key: key("bob", "c"), reason: "not_included" },
    ]);
  });

  it("reports an include filter DataSync would refuse", () => {
    expect(taskProblems(taskWith({}, { includes: "*.png" }))).toHaveLength(1);
  });
});

describe("a listing from outside", () => {
  it("refuses a negative size and a time that is not a timestamp", () => {
    const entry = {
      key: "u/a/n/1",
      size: 3,
      checksum: "abc",
      lastModified: "2026-10-13T00:00:00Z",
    };
    expect(v.safeParse(listingSchema, [entry]).success).toBe(true);
    expect(v.safeParse(listingSchema, [{ ...entry, size: -1 }]).success).toBe(false);
    expect(v.safeParse(listingSchema, [{ ...entry, lastModified: "yesterday" }]).success).toBe(
      false,
    );
  });
});
