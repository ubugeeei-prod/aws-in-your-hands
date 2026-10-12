import { describe, expect, it } from "vite-plus/test";

import { freshProgress, NOTES_RECOVERY, runOrder, runRecovery, type Step } from "../src/order.ts";

const recording = (fail: (id: string, attempt: number) => boolean) => {
  const calls: string[] = [];
  const attempts = new Map<string, number>();
  return {
    calls,
    execute: async (step: Step) => {
      const attempt = (attempts.get(step.id) ?? 0) + 1;
      attempts.set(step.id, attempt);
      calls.push(step.id);
      if (fail(step.id, attempt)) {
        throw new Error(`${step.id} failed`);
      }
    },
  };
};

describe("the order of a recovery", () => {
  it("launches the owner of the data first and switches the address last", () => {
    expect(runOrder(NOTES_RECOVERY)).toEqual([
      "launch-instance",
      "verify-app",
      "fence-source",
      "switch-address",
    ]);
  });

  it("does not depend on the order the steps were written in", () => {
    expect(runOrder(NOTES_RECOVERY.toReversed())).toEqual(runOrder(NOTES_RECOVERY));
  });

  it("refuses a circle and a dependency that does not exist", () => {
    expect(() =>
      runOrder([
        { id: "a", dependsOn: ["b"], what: "" },
        { id: "b", dependsOn: ["a"], what: "" },
      ]),
    ).toThrow(/circle/);
    expect(() => runOrder([{ id: "a", dependsOn: ["ghost"], what: "" }])).toThrow(/does not exist/);
  });
});

describe("a recovery that fails in the middle", () => {
  it("never switches the address when the app check fails", async () => {
    const { calls, execute } = recording((id) => id === "verify-app");
    const result = await runRecovery(NOTES_RECOVERY, freshProgress(NOTES_RECOVERY), execute);
    expect(result.outcome).toBe("stopped");
    expect(calls).toEqual(["launch-instance", "verify-app"]);
    expect(result.blocked).toEqual(["fence-source", "switch-address"]);
    expect(result.progress).toEqual({
      "launch-instance": "done",
      "verify-app": "failed",
      "fence-source": "pending",
      "switch-address": "pending",
    });
  });

  it("resumes from the failed step without launching a second instance", async () => {
    const { calls, execute } = recording((id, attempt) => id === "verify-app" && attempt === 1);
    const first = await runRecovery(NOTES_RECOVERY, freshProgress(NOTES_RECOVERY), execute);
    const second = await runRecovery(NOTES_RECOVERY, first.progress, execute);
    expect(second.outcome).toBe("complete");
    expect(second.ran).toEqual(["verify-app", "fence-source", "switch-address"]);
    expect(calls.filter((id) => id === "launch-instance")).toHaveLength(1);
    expect(calls.filter((id) => id === "switch-address")).toHaveLength(1);
  });

  it("does nothing on a third run", async () => {
    const { calls, execute } = recording(() => false);
    const done = await runRecovery(NOTES_RECOVERY, freshProgress(NOTES_RECOVERY), execute);
    const again = await runRecovery(NOTES_RECOVERY, done.progress, execute);
    expect(again.ran).toEqual([]);
    expect(calls).toHaveLength(NOTES_RECOVERY.length);
  });

  it("repeats a step that failed after taking effect, which is why steps must be safe to repeat", async () => {
    let switched = 0;
    let lostReply = true;
    const execute = async (step: Step) => {
      if (step.id === "switch-address") {
        switched += 1;
        if (lostReply) {
          lostReply = false;
          throw new Error("the change was made, the answer never arrived");
        }
      }
    };
    const first = await runRecovery(NOTES_RECOVERY, freshProgress(NOTES_RECOVERY), execute);
    await runRecovery(NOTES_RECOVERY, first.progress, execute);
    expect(switched).toBe(2);
  });
});
