import { describe, expect, it } from "vite-plus/test";
import { partKey } from "../src/job.ts";
import { localDefinition, localInvoke } from "../src/local.ts";
import { type Invoke, runWorkflow, TaskError } from "../src/local-workflow.ts";
import { atMostPages } from "../src/steps.ts";
import { ID, ids, range, setup, START } from "./harness.ts";

/** One page per call, so the loop in the definition goes round. */
const invokeFor = (t: ReturnType<typeof setup>): Invoke =>
  localInvoke(t.deps, () => ({ pageSize: 10, mayContinue: atMostPages(1) }));

const states = (outcome: { steps: { state: string; error?: string }[] }) =>
  outcome.steps.map((step) => (step.error === undefined ? step.state : `${step.state}!${step.error}`));

describe("the export workflow, run locally", () => {
  it("loops over the pages, then finishes", async () => {
    const t = setup(25);
    const outcome = await runWorkflow(localDefinition, START, invokeFor(t));
    expect(outcome.status).toBe("SUCCEEDED");
    expect(states(outcome)).toEqual(["ExportPages", "ExportPages", "ExportPages", "Finish"]);
    expect(outcome).toMatchObject({ output: { exportId: ID, parts: 3, notes: 25 } });
    expect(ids(t.read())).toEqual(range(1, 25));
  });

  it("retries a step whose answer was lost, without writing anything twice", async () => {
    const t = setup(25);
    const invoke = invokeFor(t);
    let lost = 1;
    // The worker does its work, and the workflow never hears back.
    const flaky: Invoke = async (resource, input) => {
      const output = await invoke(resource, input);
      if (resource.endsWith("export-pages") && lost-- > 0) {
        throw new TaskError("States.Timeout", "the task did not answer in time");
      }
      return output;
    };
    const outcome = await runWorkflow(localDefinition, START, flaky);
    expect(states(outcome)).toEqual([
      "ExportPages!States.Timeout",
      "ExportPages",
      "ExportPages",
      "ExportPages",
      "Finish",
    ]);
    expect(await t.parts()).toHaveLength(3);
    expect(ids(t.read())).toEqual(range(1, 25));
  });

  it("stops after the retries run out, and resumes from the failed step", async () => {
    const t = setup(45);
    // Two parts succeed. Then the bucket refuses four writes in a row: one try and three retries.
    t.failStoreAfter("putIfAbsent", 2, 4);
    const failed = await runWorkflow(localDefinition, START, invokeFor(t));
    expect(failed.status).toBe("FAILED");
    expect(states(failed)).toEqual([
      "ExportPages",
      "ExportPages",
      "ExportPages!Error",
      "ExportPages!Error",
      "ExportPages!Error",
      "ExportPages!Error",
    ]);
    // Nothing is cleaned up: the parts are what the next run continues from.
    expect(await t.parts()).toEqual([partKey(ID, 1), partKey(ID, 2)]);
    expect(t.read()).toBeUndefined();
    if (failed.status !== "FAILED" || failed.resume === undefined) {
      throw new Error("expected a failure that can be resumed");
    }
    expect(failed.resume).toMatchObject({ state: "ExportPages", input: { nextPart: 3, notes: 20 } });

    // What a redrive does: the failed state again, with the input it had.
    const resumed = await runWorkflow(localDefinition, failed.resume.input, invokeFor(t), failed.resume);
    expect(resumed.status).toBe("SUCCEEDED");
    expect(states(resumed)).toEqual(["ExportPages", "ExportPages", "ExportPages", "Finish"]);
    expect(ids(t.read())).toEqual(range(1, 45));
  });

  it("gives the same export when the whole run is started again from the beginning", async () => {
    const t = setup(45);
    t.failStoreAfter("putIfAbsent", 2, 4);
    await runWorkflow(localDefinition, START, invokeFor(t));

    const again = await runWorkflow(localDefinition, START, invokeFor(t));
    expect(again.status).toBe("SUCCEEDED");
    expect(await t.parts()).toHaveLength(5);
    expect(ids(t.read())).toEqual(range(1, 45));
  });

  it("discards the export, without retrying, when a part has gone missing", async () => {
    const t = setup(25);
    const invoke = invokeFor(t);
    const sabotaged: Invoke = async (resource, input) => {
      if (resource.endsWith("finish")) {
        await t.deps.store.delete(partKey(ID, 2));
      }
      return invoke(resource, input);
    };
    const outcome = await runWorkflow(localDefinition, START, sabotaged);
    expect(states(outcome)).toEqual(["ExportPages", "ExportPages", "ExportPages", "Finish!ExportCorrupt", "Discard"]);
    expect(outcome).toMatchObject({ status: "FAILED", error: "ExportDiscarded" });
    // A Fail state is the end: a redrive would only fail again.
    expect(outcome).not.toHaveProperty("resume");
    expect(await t.parts()).toEqual([]);
    expect(t.read()).toBeUndefined();
  });

  it("retries the compensation too", async () => {
    const t = setup(25);
    const invoke = invokeFor(t);
    let first = true;
    const sabotaged: Invoke = async (resource, input) => {
      if (resource.endsWith("finish")) {
        await t.deps.store.delete(partKey(ID, 2));
      }
      if (resource.endsWith("discard") && first) {
        first = false;
        // One part is deleted before the failure, the other after the retry.
        t.failStoreAfter("delete", 1);
      }
      return invoke(resource, input);
    };
    const outcome = await runWorkflow(localDefinition, START, sabotaged);
    expect(states(outcome).slice(-3)).toEqual(["Finish!ExportCorrupt", "Discard!Error", "Discard"]);
    expect(await t.parts()).toEqual([]);
  });
});

describe("the definition", () => {
  it("gives every task a timeout and a retry", () => {
    const tasks = Object.values(localDefinition.States).filter((state) => state.Type === "Task");
    expect(tasks).toHaveLength(3);
    for (const task of tasks) {
      expect(task.TimeoutSeconds).toBeGreaterThan(0);
      expect(task.Retry?.at(-1)?.ErrorEquals).toEqual(["States.ALL"]);
    }
  });

  it("catches only the error that a retry cannot fix", () => {
    const catchers = Object.values(localDefinition.States).flatMap((state) =>
      state.Type === "Task" ? (state.Catch ?? []) : [],
    );
    expect(catchers).toEqual([{ ErrorEquals: ["ExportCorrupt"], ResultPath: "$.error", Next: "Discard" }]);
  });

  it("names only states that exist", () => {
    const names = new Set(Object.keys(localDefinition.States));
    const targets = Object.values(localDefinition.States).flatMap((state) => {
      if (state.Type === "Task") {
        return [state.Next, ...(state.Catch ?? []).map((catcher) => catcher.Next)];
      }
      return state.Type === "Choice" ? [state.Default, ...state.Choices.map((choice) => choice.Next)] : [];
    });
    expect(names.has(localDefinition.StartAt)).toBe(true);
    expect(targets.filter((target) => !names.has(target))).toEqual([]);
  });
});
