import { DescribeTasksCommand, ListTasksCommand, StopTaskCommand } from "@aws-sdk/client-ecs";
import { describe, expect, it } from "vite-plus/test";

import { RUNNER } from "../src/config.ts";
import { expired } from "../src/sweep.ts";
import { sweep } from "../src/sweeper.ts";

const now = new Date("2026-10-13T12:00:00Z");
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

describe("which tasks are too old", () => {
  it("names only the tasks past the limit", () => {
    const tasks = [
      { taskArn: "young", createdAt: ago(60) },
      { taskArn: "at-the-limit", createdAt: ago(RUNNER.maxTaskSeconds) },
      { taskArn: "old", createdAt: ago(RUNNER.maxTaskSeconds + 1) },
    ];
    expect(expired(tasks, now, RUNNER.maxTaskSeconds)).toEqual(["old"]);
  });
});

describe("the sweep", () => {
  it("stops the old tasks of its cluster, page by page, and nothing else", async () => {
    const sent: unknown[] = [];
    const client = {
      async send(command: unknown) {
        sent.push(command);
        if (command instanceof ListTasksCommand) {
          return command.input.nextToken === undefined
            ? { taskArns: ["a", "b"], nextToken: "more" }
            : { taskArns: ["c"] };
        }
        if (command instanceof DescribeTasksCommand) {
          return {
            tasks: (command.input.tasks ?? []).map((taskArn) => ({
              taskArn,
              createdAt: taskArn === "b" ? ago(60) : ago(RUNNER.maxTaskSeconds + 5),
            })),
          };
        }
        return {};
      },
    };
    expect(await sweep(client as never, "cluster-1", now, RUNNER.maxTaskSeconds)).toEqual([
      "a",
      "c",
    ]);
    const stops = sent.filter((command) => command instanceof StopTaskCommand);
    expect(stops.map((command) => command.input)).toEqual([
      { cluster: "cluster-1", task: "a", reason: "older than the runner time limit" },
      { cluster: "cluster-1", task: "c", reason: "older than the runner time limit" },
    ]);
  });

  it("does nothing in an empty cluster", async () => {
    const client = { send: async () => ({ taskArns: [] }) };
    expect(await sweep(client as never, "cluster-1", now, RUNNER.maxTaskSeconds)).toEqual([]);
  });
});
