import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { EXIT_CODE, parseJobEnv, runJob } from "../src/job.ts";

const jobEntry = fileURLToPath(new URL("../src/job-main.ts", import.meta.url));

describe("runJob", () => {
  const run = (items: number, startAt: number, stopBefore: number | null) => {
    const done: number[] = [];
    const logged: Record<string, unknown>[] = [];
    const result = runJob({
      items,
      startAt,
      work: async (item) => void done.push(item),
      stopRequested: () => stopBefore !== null && done.length >= stopBefore,
      log: (entry) => void logged.push(entry),
    });
    return result.then((value) => ({ value, done, logged }));
  };

  it("does every item once, in order", async () => {
    const { value, done } = await run(5, 0, null);
    expect(value).toEqual({ status: "done", next: 5, total: 5 });
    expect(done).toEqual([0, 1, 2, 3, 4]);
  });

  it("stops between two items and says where to resume", async () => {
    const { value, done, logged } = await run(5, 0, 2);
    expect(value).toEqual({ status: "interrupted", next: 2, total: 5 });
    expect(done).toEqual([0, 1]);
    expect(logged.at(-1)).toMatchObject({ message: "interrupted", next: 2 });
  });

  it("resumed from the checkpoint, the two runs together do every item exactly once", async () => {
    const first = await run(8, 0, 3);
    const second = await run(8, first.value.next, null);
    expect([...first.done, ...second.done]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(second.value.status).toBe("done");
  });

  it("resumed from the beginning instead, repeats what was done: the work has to tolerate that", async () => {
    const first = await run(4, 0, 2);
    const again = await run(4, 0, null);
    expect([...first.done, ...again.done]).toEqual([0, 1, 0, 1, 2, 3]);
  });
});

describe("parseJobEnv", () => {
  it("has defaults for everything", () => {
    expect(parseJobEnv({})).toEqual({
      JOB_ITEMS: 20,
      JOB_START_AT: 0,
      JOB_ITEM_MS: 250,
      APP_VERSION: "dev",
    });
  });

  it("refuses values that are not whole numbers, and a start past the end", () => {
    expect(() => parseJobEnv({ JOB_ITEMS: "ten" })).toThrow(/JOB_ITEMS/);
    expect(() => parseJobEnv({ JOB_ITEMS: "-1" })).toThrow(/JOB_ITEMS/);
    expect(() => parseJobEnv({ JOB_ITEMS: "1e3" })).toThrow(/JOB_ITEMS/);
    expect(() => parseJobEnv({ JOB_ITEMS: "5", JOB_START_AT: "6" })).toThrow(/JOB_START_AT/);
  });
});

// #region interrupted
describe("the job as a process", () => {
  let child: ChildProcess | undefined;
  afterEach(() => void child?.kill("SIGKILL"));

  const start = (env: Record<string, string>) => {
    child = spawn(process.execPath, [jobEntry], {
      env: { PATH: process.env["PATH"], JOB_ITEM_MS: "30", ...env },
      stdio: ["ignore", "pipe", "inherit"],
    });
    const exited = once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
    const lines = createInterface({ input: child.stdout ?? process.stdin });
    return { child, exited, lines };
  };

  it("interrupted by SIGTERM and run again from its checkpoint, does every item exactly once", async () => {
    const done: number[] = [];
    let next: number | undefined;

    // 1. The first run is told to stop after its third item, as a Spot interruption would.
    const first = start({ JOB_ITEMS: "12" });
    for await (const line of first.lines) {
      const entry = JSON.parse(line) as { message: string; item?: number; next?: number };
      if (entry.message === "item done" && entry.item !== undefined) {
        done.push(entry.item);
        if (entry.item === 2) {
          first.child.kill("SIGTERM");
        }
      }
      if (entry.message === "interrupted") {
        next = entry.next;
      }
    }
    // 2. It stops between two items, and the exit code says the work is not finished.
    expect(await first.exited).toEqual([EXIT_CODE.interrupted, null]);
    expect(next).toBeGreaterThanOrEqual(3);
    expect(done).toEqual(Array.from({ length: next ?? 0 }, (_, index) => index));

    // 3. The second run gets the checkpoint as an override, and finishes.
    const second = start({ JOB_ITEMS: "12", JOB_START_AT: String(next) });
    for await (const line of second.lines) {
      const entry = JSON.parse(line) as { message: string; item?: number };
      if (entry.message === "item done" && entry.item !== undefined) {
        done.push(entry.item);
      }
    }
    expect(await second.exited).toEqual([EXIT_CODE.done, null]);
    expect(done).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("exits with an error, and does nothing, when its settings are wrong", async () => {
    const { exited, lines } = start({ JOB_ITEMS: "many" });
    const seen: string[] = [];
    for await (const line of lines) {
      seen.push(line);
    }
    const [code] = await exited;
    expect(code).toBe(1);
    expect(seen).toEqual([]);
  });
});
// #endregion interrupted
