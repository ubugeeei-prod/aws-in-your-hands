import { describe, expect, it } from "vite-plus/test";

import { startedBy } from "../src/job.ts";
import { sweep } from "../src/reaper.ts";
import { fakePorts, NOW, SETTINGS } from "./helpers.ts";

const seconds = NOW.getTime() / 1000;
const task = (n: number, deadlineSeconds: number) => ({
  taskArn: `arn:aws:ecs:ap-northeast-1:111111111111:task/sandbox/${n}`,
  startedBy: startedBy(`0b9f6c1e-52a7-4a3e-9d55-3f1f0c2a7e0${n}`, deadlineSeconds),
});

describe("the reaper", () => {
  it("asks CloudWatch nothing while no task runs", async () => {
    const fake = fakePorts();
    expect(await sweep(fake.ports, SETTINGS)).toEqual({ stopped: [], failed: [] });
    expect(fake.calls).toEqual(["runningTasks"]);
  });

  it("stops the task that is past its deadline and leaves the other", async () => {
    const fake = fakePorts({ tasks: [task(1, seconds - 1), task(2, seconds + 600)] });
    const result = await sweep(fake.ports, SETTINGS);
    expect(result.stopped).toEqual([{ taskArn: task(1, 0).taskArn, reason: "deadline" }]);
    expect(fake.stopped).toEqual([
      { taskArn: task(1, 0).taskArn, reason: "agent sandbox: deadline" },
    ]);
    expect(fake.world.tasks.map((item) => item.taskArn)).toEqual([task(2, 0).taskArn]);
  });

  it("stops everything when the day's budget is spent", async () => {
    const fake = fakePorts({
      tasks: [task(1, seconds + 600), task(2, seconds + 600)],
      // 4 million output tokens at USD 5.50 per million is USD 22.
      tokens: { input: 0, output: 4_000_000, cacheRead: 0, cacheWrite: 0 },
    });
    const result = await sweep(fake.ports, SETTINGS);
    expect(result.stopped.map((stop) => stop.reason)).toEqual(["daily_budget", "daily_budget"]);
  });

  it("goes on to the next task when one will not stop, and reports the one that did not", async () => {
    const stuck = task(1, seconds - 1);
    const fake = fakePorts({ tasks: [stuck, task(2, seconds - 1)], unstoppable: [stuck.taskArn] });
    const result = await sweep(fake.ports, SETTINGS);
    expect(result.failed).toEqual([{ taskArn: stuck.taskArn, error: "ServerException" }]);
    expect(result.stopped.map((stop) => stop.taskArn)).toEqual([task(2, 0).taskArn]);
    // The next sweep, a minute later, tries the stuck one again.
    fake.world.unstoppable = [];
    expect((await sweep(fake.ports, SETTINGS)).stopped.map((stop) => stop.taskArn)).toEqual([
      stuck.taskArn,
    ]);
  });
});
