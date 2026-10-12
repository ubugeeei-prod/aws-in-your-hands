import { describe, expect, it } from "vite-plus/test";

import { handleExecutionEvent } from "../src/alert.ts";
import { readEnv } from "../src/env.ts";
import { decide } from "../src/execution-event.ts";
import { isStale, worstCaseLagHours } from "../src/lag.ts";

const TASK = "arn:aws:datasync:ap-northeast-3:111122223333:task/task-08de6e6697796f026";

// The envelope and `detail` of AWS's sample event, with this task's ARN.
const event = (state: string, taskArn = TASK) => ({
  version: "0",
  id: "example0-c014-d9e9-d7ac-44f00d5d1200",
  "detail-type": "DataSync Task Execution State Change",
  source: "aws.datasync",
  account: "111122223333",
  time: "2026-10-13T18:07:26Z",
  region: "ap-northeast-3",
  resources: [`${taskArn}/execution/exec-04ce9d516d69bd52f`],
  detail: { State: state },
});

describe("what an execution event leads to", () => {
  it("alerts on a failed execution of the archive task", () => {
    expect(decide(event("ERROR"), TASK)).toMatchObject({
      action: "alert",
      reason: "execution_failed",
    });
  });

  it("records a success without alerting", () => {
    expect(decide(event("SUCCESS"), TASK)).toEqual({
      action: "record",
      reason: "execution_succeeded",
    });
  });

  it("ignores states that are not an ending", () => {
    expect(decide(event("TRANSFERRING"), TASK)).toEqual({ action: "ignore", reason: "not_final" });
  });

  it("ignores another task in the same account, even a failed one", () => {
    const other = "arn:aws:datasync:ap-northeast-3:111122223333:task/task-0aaaaaaaaaaaaaaaa";
    expect(decide(event("ERROR", other), TASK)).toEqual({ action: "ignore", reason: "other_task" });
  });

  it("alerts when the event cannot be read, and names the field", () => {
    const { detail: _detail, ...withoutDetail } = event("ERROR");
    expect(decide(withoutDetail, TASK)).toMatchObject({
      action: "alert",
      reason: "unreadable_event",
      message: expect.stringContaining("detail"),
    });
    expect(decide({ ...event("ERROR"), resources: ["arn:aws:s3:::a-bucket"] }, TASK)).toMatchObject(
      { action: "alert", reason: "unreadable_event" },
    );
    expect(decide("not an event", TASK)).toMatchObject({ action: "alert" });
  });
});

describe("the handler", () => {
  const run = async (input: unknown, notify = async () => {}) => {
    const sent: string[] = [];
    const lines: Record<string, unknown>[] = [];
    const decision = await handleExecutionEvent(input, {
      taskArn: TASK,
      notifier: {
        notify: async (subject) => {
          await notify();
          sent.push(subject);
        },
      },
      log: (line) => lines.push(line),
    });
    return { decision, sent, lines };
  };

  it("publishes once for a failure and logs it as an error", async () => {
    const { sent, lines } = await run(event("ERROR"));
    expect(sent).toEqual(["Archive copy: execution_failed"]);
    expect(lines).toMatchObject([{ level: "error", reason: "execution_failed" }]);
  });

  it("publishes nothing for a success", async () => {
    const { sent, lines } = await run(event("SUCCESS"));
    expect(sent).toEqual([]);
    expect(lines).toMatchObject([{ level: "info", action: "record" }]);
  });

  it("fails when the alert could not be sent, so that Lambda delivers the event again", async () => {
    const failing = run(event("ERROR"), async () => {
      throw new Error("sns is throttling");
    });
    await expect(failing).rejects.toThrow("sns is throttling");
  });
});

describe("how old the archive may be", () => {
  const daily = { intervalHours: 24, executionHours: 2, toleratedFailures: 1 };

  it("is one interval plus one execution, plus one interval for each failure put up with", () => {
    expect(worstCaseLagHours({ ...daily, toleratedFailures: 0 })).toBe(26);
    expect(worstCaseLagHours(daily)).toBe(50);
  });

  it("cannot be bought down below DataSync's hourly schedule", () => {
    expect(() => worstCaseLagHours({ ...daily, intervalHours: 0.5 })).toThrow(/once an hour/);
  });

  it("calls the archive stale once the last success is older than that", () => {
    const now = new Date("2026-10-15T20:00:00Z");
    expect(isStale(new Date("2026-10-13T18:30:00Z"), now, daily)).toBe(false);
    expect(isStale(new Date("2026-10-13T17:30:00Z"), now, daily)).toBe(true);
    expect(isStale(undefined, now, daily)).toBe(true);
  });
});

describe("the function's environment", () => {
  it("wants a task ARN and a topic ARN, and refuses a location ARN in the task's place", () => {
    const topic = "arn:aws:sns:ap-northeast-3:111122223333:AihDataMovementArchive-Alerts";
    expect(readEnv({ TASK_ARN: TASK, ALERT_TOPIC_ARN: topic }).TASK_ARN).toBe(TASK);
    const location = "arn:aws:datasync:ap-northeast-3:111122223333:location/loc-0b3017fc4ba4a2d8d";
    expect(() => readEnv({ TASK_ARN: location, ALERT_TOPIC_ARN: topic })).toThrow();
    expect(() => readEnv({ TASK_ARN: TASK })).toThrow();
  });
});
