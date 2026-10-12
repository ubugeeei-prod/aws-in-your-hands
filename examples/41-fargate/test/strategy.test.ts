import { describe, expect, it } from "vite-plus/test";

import { SCALING, STRATEGY } from "../src/config.ts";
import { splitTasks, strategyProblems, type StrategyItem } from "../src/strategy.ts";

describe("the deployed strategy", () => {
  it("is one ECS accepts", () => {
    expect(strategyProblems(STRATEGY)).toEqual([]);
  });

  it("puts every task up to the minimum on on-demand Fargate", () => {
    for (let tasks = 0; tasks <= SCALING.minTasks; tasks += 1) {
      expect(splitTasks(STRATEGY, tasks)).toEqual({ FARGATE: tasks, FARGATE_SPOT: 0 });
    }
  });

  it("splits what auto scaling adds one to three, so losing all of Spot never goes below the base", () => {
    expect(splitTasks(STRATEGY, 3)).toEqual({ FARGATE: 2, FARGATE_SPOT: 1 });
    expect(splitTasks(STRATEGY, SCALING.maxTasks)).toEqual({ FARGATE: 3, FARGATE_SPOT: 3 });
    for (let tasks = SCALING.minTasks; tasks <= SCALING.maxTasks; tasks += 1) {
      expect(splitTasks(STRATEGY, tasks).FARGATE).toBeGreaterThanOrEqual(SCALING.minTasks);
    }
  });
});

describe("strategyProblems", () => {
  const spot: StrategyItem = { capacityProvider: "FARGATE_SPOT", weight: 1 };

  it("refuses two bases", () => {
    expect(
      strategyProblems([
        { capacityProvider: "FARGATE", base: 1, weight: 1 },
        { ...spot, base: 1 },
      ]),
    ).toEqual(["only one capacity provider can have a base"]);
  });

  it("refuses a strategy in which no provider can place a task", () => {
    expect(
      strategyProblems([
        { capacityProvider: "FARGATE", weight: 0 },
        { ...spot, weight: 0 },
      ]),
    ).toEqual(["at least one capacity provider needs a weight above zero"]);
  });

  it("refuses numbers outside the documented ranges", () => {
    expect(strategyProblems([{ ...spot, weight: 1001 }])).toHaveLength(1);
    expect(strategyProblems([{ ...spot, base: 100_001 }])).toHaveLength(1);
  });
});

describe("splitTasks", () => {
  it("follows the documented example: weights 1 and 4 give one task for every four", () => {
    const strategy: StrategyItem[] = [
      { capacityProvider: "FARGATE", weight: 1 },
      { capacityProvider: "FARGATE_SPOT", weight: 4 },
    ];
    expect(splitTasks(strategy, 10)).toEqual({ FARGATE: 2, FARGATE_SPOT: 8 });
  });

  it("with Spot alone, a service has nothing that survives an interruption", () => {
    expect(splitTasks([{ capacityProvider: "FARGATE_SPOT", weight: 1 }], 4)).toEqual({
      FARGATE: 0,
      FARGATE_SPOT: 4,
    });
  });
});
