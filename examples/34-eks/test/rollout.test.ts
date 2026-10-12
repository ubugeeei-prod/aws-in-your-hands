import { describe, expect, it } from "vite-plus/test";

import { WORKLOAD } from "../src/config.ts";
import {
  availabilityFloor,
  disruptionsAllowed,
  drainNode,
  resolve,
  rolloutBounds,
  rolloutSteps,
} from "../src/rollout.ts";

const shipped = {
  replicas: WORKLOAD.replicas,
  maxSurge: WORKLOAD.maxSurge,
  maxUnavailable: WORKLOAD.maxUnavailable,
};
const shippedBudget = { maxUnavailable: WORKLOAD.budgetMaxUnavailable };

describe("a number of pods or a percentage", () => {
  it("rounds the way it is told", () => {
    expect(resolve("25%", 10, "up")).toBe(3);
    expect(resolve("25%", 10, "down")).toBe(2);
    expect(resolve(3, 10, "up")).toBe(3);
    expect(() => resolve("a quarter", 10, "up")).toThrow();
  });
});

describe("a rolling update", () => {
  // #region rolling
  it("as shipped: four pods at most, never fewer than two available", () => {
    expect(rolloutBounds(shipped)).toEqual({
      surge: 2,
      unavailable: 0,
      minAvailable: 2,
      maxTotal: 4,
    });
    expect(rolloutSteps(shipped)).toEqual([
      { old: 2, new: 0, available: 2, total: 2 },
      { old: 2, new: 2, available: 2, total: 4 },
      { old: 2, new: 2, available: 4, total: 4 },
      { old: 0, new: 2, available: 2, total: 2 },
    ]);
  });

  it("with the defaults of 25% and 25%, two replicas round to one extra pod and none missing", () => {
    // 25% of 2 is 0.5: the surge rounds up to 1, the unavailable share rounds down to 0.
    expect(rolloutBounds({ replicas: 2, maxSurge: "25%", maxUnavailable: "25%" })).toEqual({
      surge: 1,
      unavailable: 0,
      minAvailable: 2,
      maxTotal: 3,
    });
  });

  it("without surge: one pod is stopped before its replacement starts", () => {
    const steps = rolloutSteps({ replicas: 2, maxSurge: 0, maxUnavailable: 1 });
    expect(Math.min(...steps.map((step) => step.available))).toBe(1);
    expect(Math.max(...steps.map((step) => step.total))).toBe(2);
    expect(steps.at(-1)).toEqual({ old: 0, new: 2, available: 2, total: 2 });
  });

  it("refuses 0 and 0: such a rollout could not start", () => {
    expect(() => rolloutBounds({ replicas: 2, maxSurge: 0, maxUnavailable: 0 })).toThrow();
    expect(() => rolloutBounds({ replicas: 2, maxSurge: 0, maxUnavailable: "25%" })).toThrow();
  });
  // #endregion rolling

  it("never goes below the floor or above the ceiling, whatever the numbers", () => {
    for (const replicas of [1, 2, 3, 5, 10]) {
      for (const maxSurge of [0, 1, "25%", "100%"]) {
        for (const maxUnavailable of [0, 1, "25%", "50%"]) {
          const update = { replicas, maxSurge, maxUnavailable };
          let bounds;
          try {
            bounds = rolloutBounds(update);
          } catch {
            continue;
          }
          const steps = rolloutSteps(update);
          expect(Math.min(...steps.map((step) => step.available))).toBeGreaterThanOrEqual(
            bounds.minAvailable,
          );
          expect(Math.max(...steps.map((step) => step.total))).toBeLessThanOrEqual(bounds.maxTotal);
          expect(steps.at(-1)).toEqual({
            old: 0,
            new: replicas,
            available: replicas,
            total: replicas,
          });
        }
      }
    }
  });
});

describe("a disruption budget", () => {
  // #region budget
  it("as shipped: one eviction is allowed while both pods are healthy, none after it", () => {
    expect(disruptionsAllowed(shippedBudget, 2, 2)).toEqual({ desiredHealthy: 1, allowed: 1 });
    expect(disruptionsAllowed(shippedBudget, 2, 1)).toEqual({ desiredHealthy: 1, allowed: 0 });
  });

  it("rounds a percentage up, both ways round", () => {
    // The documentation's example: 50% of 7 pods means 4 must stay.
    expect(disruptionsAllowed({ minAvailable: "50%" }, 7, 7)).toEqual({
      desiredHealthy: 4,
      allowed: 3,
    });
    // 30% of 7 is 2.1, so 3 may be missing: more than the percentage reads.
    expect(disruptionsAllowed({ maxUnavailable: "30%" }, 7, 7)).toEqual({
      desiredHealthy: 4,
      allowed: 3,
    });
  });

  it("allows nothing when minAvailable equals the replicas", () => {
    expect(disruptionsAllowed({ minAvailable: 2 }, 2, 2).allowed).toBe(0);
    expect(disruptionsAllowed({ minAvailable: "100%" }, 2, 2).allowed).toBe(0);
  });

  it("with one replica, maxUnavailable 1 allows the only pod to go", () => {
    expect(disruptionsAllowed({ maxUnavailable: 1 }, 1, 1)).toEqual({
      desiredHealthy: 0,
      allowed: 1,
    });
  });
  // #endregion budget
});

describe("draining a node", () => {
  const together = [
    { name: "a", node: "node-1" },
    { name: "b", node: "node-1" },
  ];
  const drain = (budget?: Parameters<typeof drainNode>[0]["budget"]) =>
    drainNode({ pods: together, node: "node-1", elsewhere: "node-2", replicas: 2, budget });

  // #region drain
  it("as shipped: the two pods leave one after the other, and one is always healthy", () => {
    expect(drain(shippedBudget)).toEqual({
      events: [
        { round: 1, kind: "evicted", pod: "a" },
        { round: 1, kind: "refused", pod: "b" },
        { round: 1, kind: "replaced", pod: "a", node: "node-2" },
        { round: 2, kind: "evicted", pod: "b" },
        { round: 2, kind: "replaced", pod: "b", node: "node-2" },
      ],
      lowestHealthy: 1,
      stuck: false,
    });
  });

  it("without a budget: both pods go at once, and for a while nothing answers", () => {
    const result = drain();
    expect(result.lowestHealthy).toBe(0);
    expect(result.events.filter((event) => event.kind === "refused")).toEqual([]);
  });

  it("with minAvailable equal to the replicas: every eviction is refused, and the drain never ends", () => {
    expect(drain({ minAvailable: 2 })).toEqual({
      events: [
        { round: 1, kind: "refused", pod: "a" },
        { round: 1, kind: "refused", pod: "b" },
      ],
      lowestHealthy: 2,
      stuck: true,
    });
  });
  // #endregion drain

  it("leaves the pods of other nodes alone", () => {
    const spread = [
      { name: "a", node: "node-1" },
      { name: "b", node: "node-2" },
    ];
    const result = drainNode({
      pods: spread,
      node: "node-1",
      elsewhere: "node-3",
      replicas: 2,
      budget: shippedBudget,
    });
    expect(result.events.map((event) => event.pod)).toEqual(["a", "a"]);
    expect(result.lowestHealthy).toBe(1);
  });

  it("is a drain of nothing when the node holds no pod", () => {
    expect(drainNode({ pods: together, node: "node-9", elsewhere: "node-2", replicas: 2 })).toEqual(
      { events: [], lowestHealthy: 2, stuck: false },
    );
  });
});

describe("a rollout and a drain at the same time", () => {
  // #region floor
  it("as shipped: one pod is the least that voluntary disruptions can leave", () => {
    expect(availabilityFloor(shipped, shippedBudget)).toBe(1);
  });

  it("without a budget there is no floor", () => {
    expect(availabilityFloor(shipped)).toBe(0);
  });

  it("takes the lower of the two when the rollout itself may remove pods", () => {
    const update = { replicas: 10, maxSurge: "25%", maxUnavailable: "25%" };
    // The rollout may go down to 8, the budget would let a drain go down to 9.
    expect(availabilityFloor(update, { maxUnavailable: 1 })).toBe(8);
    // Here the budget is the looser of the two.
    expect(availabilityFloor(update, { minAvailable: "50%" })).toBe(5);
  });
  // #endregion floor
});
