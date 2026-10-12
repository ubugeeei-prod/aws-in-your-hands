import { describe, expect, it } from "vite-plus/test";

import { runExecution } from "../src/execution.ts";
import type { MemoryBucket } from "../src/memory-bucket.ts";
import { planExecution } from "../src/plan.ts";
import { ARCHIVE_TASK, type ArchiveTask } from "../src/task.ts";
import { key, taskWith, text, world } from "./world.ts";

// The invariant, in two halves. Whatever the archive holds was once in the
// source, byte for byte. And once the source is quiet, one execution leaves
// nothing to copy.
const everWritten = (source: MemoryBucket, history: Map<string, Set<string>>) => {
  for (const entry of source.list()) {
    history.set(entry.key, (history.get(entry.key) ?? new Set()).add(entry.checksum));
  }
};
const nothingLeft = (source: MemoryBucket, archive: MemoryBucket, task: ArchiveTask) =>
  planExecution(source.list(), archive.list(), task).transfer.length === 0;

const seed = (source: MemoryBucket, count: number): string[] => {
  const keys = Array.from({ length: count }, (_, index) => key("alice", `a${index}`));
  for (const name of keys) {
    source.put(name, `bytes of ${name}`);
  }
  return keys;
};

describe("a run over a quiet source", () => {
  it("leaves every source object in the archive, and a second run copies nothing", () => {
    const { source, archive } = world();
    seed(source, 5);

    const first = runExecution(source, archive, ARCHIVE_TASK);
    const second = runExecution(source, archive, ARCHIVE_TASK);

    expect(first).toMatchObject({ status: "SUCCESS", verifyErrors: [] });
    expect(first.transferred).toHaveLength(5);
    expect(second.transferred).toEqual([]);
    expect(archive.operations).toHaveLength(5);
  });

  it("with TransferMode ALL pays for every object on every run", () => {
    const { source, archive } = world();
    seed(source, 5);
    const task = taskWith({ transferMode: "ALL" });

    runExecution(source, archive, task);
    runExecution(source, archive, task);

    expect(archive.operations).toHaveLength(10);
  });
});

describe("an execution that stops part-way", () => {
  it("is finished by the next run, which copies only the rest", () => {
    const { source, archive } = world();
    seed(source, 5);

    const stopped = runExecution(source, archive, ARCHIVE_TASK, { stopAfterCopies: 2 });
    expect(stopped.status).toBe("INTERRUPTED");
    expect(nothingLeft(source, archive, ARCHIVE_TASK)).toBe(false);

    const resumed = runExecution(source, archive, ARCHIVE_TASK);

    expect(resumed.transferred).toHaveLength(3);
    expect(nothingLeft(source, archive, ARCHIVE_TASK)).toBe(true);
    // Five objects, five writes: nothing was copied twice.
    expect(archive.operations.filter((operation) => operation.kind === "put")).toHaveLength(5);
  });

  it("leaves a reader of the archive with a prefix of the source, each object whole", () => {
    const { source, archive } = world();
    const keys = seed(source, 5);

    runExecution(source, archive, ARCHIVE_TASK, { stopAfterCopies: 2 });

    expect(archive.list().map((entry) => entry.key)).toEqual(keys.slice(0, 2));
    expect(text(archive, keys[0] ?? "")).toBe(`bytes of ${keys[0]}`);
  });
});

describe("writes to the source while an execution runs", () => {
  it("an object replaced after it was copied stays old in the archive until the next run", () => {
    const { source, archive } = world();
    const [first = ""] = seed(source, 3);
    const history = new Map<string, Set<string>>();
    everWritten(source, history);

    const result = runExecution(source, archive, ARCHIVE_TASK, {
      afterStep: (step) => {
        if (step.kind === "copied" && step.key === first) {
          source.put(first, "replaced during the run");
          everWritten(source, history);
        }
      },
    });

    // Only what was copied is checked, so the execution does not notice.
    expect(result.status).toBe("SUCCESS");
    expect(text(archive, first)).toBe(`bytes of ${first}`);
    for (const entry of archive.list()) {
      expect(history.get(entry.key)?.has(entry.checksum)).toBe(true);
    }

    const next = runExecution(source, archive, ARCHIVE_TASK);
    expect(next.transferred).toEqual([first]);
    expect(text(archive, first)).toBe("replaced during the run");
  });

  it("an object replaced between the listing and its copy arrives new", () => {
    const { source, archive } = world();
    const [first = ""] = seed(source, 3);

    runExecution(source, archive, ARCHIVE_TASK, {
      afterStep: (step) => {
        if (step.kind === "listed") {
          source.put(first, "replaced before the copy");
        }
      },
    });

    expect(text(archive, first)).toBe("replaced before the copy");
    expect(nothingLeft(source, archive, ARCHIVE_TASK)).toBe(true);
  });

  it("an upload after the listing is not in this run, and is in the next", () => {
    const { source, archive } = world();
    seed(source, 2);
    const late = key("bob", "late");

    runExecution(source, archive, ARCHIVE_TASK, {
      afterStep: (step) => {
        if (step.kind === "listed") {
          source.put(late, "uploaded mid-run");
        }
      },
    });
    expect(archive.get(late)).toBeUndefined();

    runExecution(source, archive, ARCHIVE_TASK);
    expect(text(archive, late)).toBe("uploaded mid-run");
  });

  it("with the whole-dataset check, the same writes end the execution in ERROR", () => {
    const { source, archive } = world();
    const [first = ""] = seed(source, 3);

    const result = runExecution(
      source,
      archive,
      taskWith({ verifyMode: "POINT_IN_TIME_CONSISTENT" }),
      {
        afterStep: (step) => {
          if (step.kind === "copied" && step.key === first) {
            source.put(first, "replaced during the run");
            source.put(key("bob", "late"), "uploaded mid-run");
          }
        },
      },
    );

    expect(result.status).toBe("ERROR");
    expect(result.verifyErrors).toEqual([
      { key: first, error: "checksum" },
      { key: key("bob", "late"), error: "added" },
    ]);
  });
});

describe("deletes in the source", () => {
  it("an object deleted before its turn is not copied, and the run still succeeds", () => {
    const { source, archive } = world();
    const keys = seed(source, 3);
    const last = keys[2] ?? "";

    const result = runExecution(source, archive, ARCHIVE_TASK, {
      afterStep: (step) => {
        if (step.kind === "listed") {
          source.delete(last);
        }
      },
    });

    expect(result).toMatchObject({ status: "SUCCESS", vanished: [last] });
    expect(archive.get(last)).toBeUndefined();
  });

  it("keeps the archived copy of a deleted object for as many runs as it likes", () => {
    const { source, archive } = world();
    const [first = ""] = seed(source, 2);
    runExecution(source, archive, ARCHIVE_TASK);

    source.delete(first);
    const result = runExecution(source, archive, ARCHIVE_TASK);

    expect(result.deleted).toEqual([]);
    expect(text(archive, first)).toBe(`bytes of ${first}`);
  });

  it("with REMOVE, the delete reaches the archive one run later", () => {
    const { source, archive } = world();
    const [first = ""] = seed(source, 2);
    const task = taskWith({ preserveDeletedFiles: "REMOVE" });
    runExecution(source, archive, task);

    source.delete(first);
    const result = runExecution(source, archive, task);

    expect(result.deleted).toEqual([first]);
    expect(archive.get(first)).toBeUndefined();
    expect(runExecution(source, archive, task).deleted).toEqual([]);
  });
});

describe("writes to the archive from somewhere else", () => {
  it("are overwritten by the next run, because the source owns the truth", () => {
    const { source, archive } = world();
    const [first = ""] = seed(source, 1);
    runExecution(source, archive, ARCHIVE_TASK);

    archive.put(first, "edited in the archive");
    runExecution(source, archive, ARCHIVE_TASK);

    expect(text(archive, first)).toBe(`bytes of ${first}`);
  });
});
