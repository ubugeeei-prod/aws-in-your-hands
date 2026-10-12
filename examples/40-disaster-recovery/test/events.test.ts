import { describe, expect, it } from "vite-plus/test";

import { handle } from "../src/events.ts";
import { events } from "./fixtures.ts";

describe("DRS events", () => {
  it("logs a successful drill launch as information, with the job to look up", () => {
    expect(handle(events.drillSucceeded)).toEqual({
      ok: true,
      line: {
        level: "info",
        message: "drill launch succeeded",
        eventId: "9da9af57-9253-4406-87cb-7cc400e43465",
        resource: "arn:aws:drs:ap-northeast-1:111122223333:source-server/s-1111111111aaaaaaa",
        state: "RECOVERY_LAUNCH_SUCCEEDED",
        jobId: "drsjob-00000000000000001",
        drill: true,
      },
    });
  });

  it("logs a failed recovery as an error and a failed drill as a warning", () => {
    expect(handle(events.recoveryFailed).line).toMatchObject({ level: "error", drill: false });
    const failedDrill = {
      ...events.recoveryFailed,
      detail: { ...events.recoveryFailed.detail, "is-drill": "TRUE" },
    };
    expect(handle(failedDrill).line).toMatchObject({ level: "warn", drill: true });
  });

  it("logs stalled replication as an error: the recovery point is ageing", () => {
    expect(handle(events.stalled).line).toMatchObject({
      level: "error",
      message: "replication stalled",
    });
    const resumed = { ...events.stalled, detail: { state: "NOT_STALLED" } };
    expect(handle(resumed).line.level).toBe("info");
  });

  it("reads the failback state from a recovery instance, not a source server", () => {
    expect(handle(events.failbackCompleted).line).toMatchObject({
      level: "info",
      state: "FAILBACK_COMPLETED",
    });
    const wrongResource = { ...events.failbackCompleted, resources: events.stalled.resources };
    expect(handle(wrongResource).ok).toBe(false);
  });

  it("refuses a state the documentation does not list, instead of guessing its level", () => {
    const unknown = { ...events.stalled, detail: { state: "PAUSED" } };
    const result = handle(unknown);
    expect(result.ok).toBe(false);
    expect(result.line).toMatchObject({ level: "error", eventId: events.stalled.id });
    expect(result.line.message).toContain("detail.state");
  });

  it("refuses is-drill as a boolean: the documented value is a string", () => {
    const typed = {
      ...events.drillSucceeded,
      detail: { ...events.drillSucceeded.detail, "is-drill": true },
    };
    expect(handle(typed).ok).toBe(false);
  });

  it("refuses an event from another source and a detail type the rule does not send", () => {
    expect(handle({ ...events.stalled, source: "aws.ec2" }).ok).toBe(false);
    expect(handle(events.snapshotTaken).ok).toBe(false);
    expect(handle(null).ok).toBe(false);
  });
});
