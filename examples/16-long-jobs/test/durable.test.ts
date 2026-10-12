import { LocalDurableTestRunner } from "@aws/durable-execution-sdk-js-testing";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { createDurableExport } from "../src/durable-export.ts";
import type { Finished } from "../src/steps.ts";
import { ID, ids, range, setup, START } from "./harness.ts";

// The SDK's own local runner: a checkpoint store in this process, no AWS.
beforeAll(() => LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }));
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

const run = (t: ReturnType<typeof setup>) =>
  new LocalDurableTestRunner<Finished>({
    handlerFunction: createDurableExport(t.deps, { pageSize: 10, pagesPerStep: 2 }),
  }).run({ payload: START });

describe("the export as a durable function", () => {
  it("checkpoints after every two pages and finishes", async () => {
    const t = setup(45);
    const execution = await run(t);
    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toMatchObject({ exportId: ID, parts: 5, notes: 45 });
    expect(execution.getOperations().map((operation) => operation.getName())).toEqual([
      "pages-from-1",
      "pages-from-3",
      "pages-from-5",
      "finish",
    ]);
    expect(ids(t.read())).toEqual(range(1, 45));
  });

  it("runs a failed step again without writing a part twice", async () => {
    const t = setup(45);
    // The third write fails: the second step has written nothing yet when it throws.
    t.failStoreAfter("putIfAbsent", 2);
    const execution = await run(t);
    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(await t.parts()).toHaveLength(5);
    expect(ids(t.read())).toEqual(range(1, 45));
  });
});
