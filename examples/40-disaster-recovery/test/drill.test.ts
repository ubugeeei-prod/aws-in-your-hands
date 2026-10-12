import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import template from "../drill/record.template.json" with { type: "json" };
import {
  type CheckResult,
  CHECKS,
  type DrillRecord,
  drillRecordSchema,
  evaluateDrill,
  planDrill,
  planServer,
  type ProtectedServer,
  startRecoveryInput,
  summarize,
} from "../src/drill.ts";

const now = new Date("2026-10-13T09:05:00.000Z");
const server = (patch: Partial<ProtectedServer> = {}): ProtectedServer => ({
  sourceServerID: "s-1111111111aaaaaaa",
  state: "CONTINUOUS",
  lagSeconds: 4,
  snapshots: [
    { snapshotID: "pit-0000000000000002b", takenAt: "2026-10-13T08:50:03.000Z" },
    { snapshotID: "pit-0000000000000003c", takenAt: "2026-10-13T09:00:04.000Z" },
  ],
  ...patch,
});

describe("planning a launch from the most recent data", () => {
  it("states the loss as the reported lag", () => {
    expect(planServer(server(), { target: "latest", rpoSeconds: 60, now })).toEqual({
      sourceServerID: "s-1111111111aaaaaaa",
      decision: "launch",
      recoverySnapshotID: null,
      recoveryPointAt: "2026-10-13T09:04:56.000Z",
      lossSeconds: 4,
      withinRpo: "yes",
      notes: [],
    });
  });

  it("says no when the lag is longer than the objective", () => {
    const plan = planServer(server({ lagSeconds: 900 }), {
      target: "latest",
      rpoSeconds: 600,
      now,
    });
    expect(plan).toMatchObject({ decision: "launch", withinRpo: "no", lossSeconds: 900 });
  });

  it("never reads an unreported lag as zero", () => {
    const plan = planServer(server({ lagSeconds: null }), {
      target: "latest",
      rpoSeconds: 600,
      now,
    });
    expect(plan).toMatchObject({ withinRpo: "unknown", lossSeconds: null, recoveryPointAt: null });
  });

  it("still launches a stalled server, and warns that the snapshot may not come", () => {
    const plan = planServer(server({ state: "STALLED", lagSeconds: null }), {
      target: "latest",
      rpoSeconds: 600,
      now,
    });
    expect(plan.decision).toBe("launch");
    expect(plan.decision === "launch" && plan.notes.join(" ")).toContain("STALLED");
  });

  it.each(["INITIATING", "INITIAL_SYNC", "STOPPED", "DISCONNECTED"] as const)(
    "refuses a server in %s",
    (state) => {
      expect(
        planServer(server({ state }), { target: "latest", rpoSeconds: 600, now }).decision,
      ).toBe("blocked");
    },
  );

  it("refuses a server whose state is not reported", () => {
    expect(
      planServer(server({ state: undefined }), { target: "latest", rpoSeconds: 600, now }).decision,
    ).toBe("blocked");
  });
});

describe("planning a launch from a point in time", () => {
  it("takes the newest snapshot at or before the point, not the nearest one", () => {
    const plan = planServer(server(), {
      target: new Date("2026-10-13T09:00:00.000Z"),
      rpoSeconds: 600,
      now,
    });
    expect(plan).toMatchObject({
      recoverySnapshotID: "pit-0000000000000002b",
      recoveryPointAt: "2026-10-13T08:50:03.000Z",
      lossSeconds: 597,
      withinRpo: "yes",
    });
  });

  it("violates an objective shorter than the gap between snapshots", () => {
    const plan = planServer(server(), {
      target: new Date("2026-10-13T09:00:00.000Z"),
      rpoSeconds: 300,
      now,
    });
    expect(plan).toMatchObject({ decision: "launch", withinRpo: "no" });
  });

  it("refuses a point older than every snapshot", () => {
    const plan = planServer(server(), {
      target: new Date("2026-10-01T00:00:00.000Z"),
      rpoSeconds: 600,
      now,
    });
    expect(plan).toMatchObject({ decision: "blocked" });
  });
});

describe("a drill of several servers", () => {
  const two = [server(), server({ sourceServerID: "s-2222222222bbbbbbb", state: "INITIAL_SYNC" })];

  it("does not meet the objective when one server cannot launch", () => {
    expect(planDrill(two, { target: "latest", rpoSeconds: 600, now }).meetsObjective).toBe(false);
    expect(planDrill([server()], { target: "latest", rpoSeconds: 600, now }).meetsObjective).toBe(
      true,
    );
  });

  it("does not meet the objective when there is no server at all", () => {
    expect(planDrill([], { target: "latest", rpoSeconds: 600, now }).meetsObjective).toBe(false);
  });

  it("asks only for the servers that can launch, and marks the job as a drill", () => {
    const input = startRecoveryInput(planDrill(two, { target: "latest", rpoSeconds: 600, now }), {
      isDrill: true,
      name: "drill-2026-10-13",
    });
    expect(input).toEqual({
      isDrill: true,
      sourceServers: [{ sourceServerID: "s-1111111111aaaaaaa" }],
      tags: { "aih:drill": "drill-2026-10-13", "aih:kind": "drill" },
    });
  });

  it("names the snapshot when a point in time was asked for", () => {
    const plan = planDrill([server()], {
      target: new Date("2026-10-13T09:01:00.000Z"),
      rpoSeconds: 600,
      now,
    });
    expect(startRecoveryInput(plan, { isDrill: true, name: "d" }).sourceServers).toEqual([
      { sourceServerID: "s-1111111111aaaaaaa", recoverySnapshotID: "pit-0000000000000003c" },
    ]);
  });

  it("refuses to build a request that would launch nothing", () => {
    const plan = planDrill([server({ state: "STOPPED" })], {
      target: "latest",
      rpoSeconds: 600,
      now,
    });
    expect(() => startRecoveryInput(plan, { isDrill: true, name: "d" })).toThrow(/No server/);
  });
});

describe("judging a drill", () => {
  const all = (outcome: CheckResult["outcome"]): CheckResult[] =>
    CHECKS.map((check) => ({ id: check.id, outcome, detail: "" }));

  it("passes only when every check ran and passed", () => {
    expect(evaluateDrill(all("pass")).result).toBe("passed");
  });

  it("is incomplete, not passed, when the instance booted and nobody looked at the notes", () => {
    const results = all("pass").filter((result) => result.id !== "notes-present");
    expect(evaluateDrill(results)).toEqual({
      result: "incomplete",
      failed: [],
      missing: ["notes-present"],
    });
  });

  it("fails on one failed check whatever else passed", () => {
    const results = all("pass").map((result) =>
      result.id === "volume-mounted" ? { ...result, outcome: "fail" as const } : result,
    );
    expect(evaluateDrill(results)).toMatchObject({ result: "failed", failed: ["volume-mounted"] });
  });

  it("counts a check marked not-run as missing", () => {
    expect(evaluateDrill(all("not-run")).missing).toHaveLength(CHECKS.length);
  });
});

describe("the record a drill leaves", () => {
  const record = (patch: Partial<DrillRecord["timeline"]> = {}): DrillRecord => ({
    name: "drill-2026-10-13",
    region: "ap-northeast-1",
    kind: "drill",
    objectives: { rpoSeconds: 600, rtoSeconds: 3600 },
    jobID: "drsjob-00000000000000001",
    timeline: {
      declaredAt: "2026-10-13T09:00:00.000Z",
      startRequestedAt: "2026-10-13T09:02:00.000Z",
      recoveryPointAt: "2026-10-13T08:58:30.000Z",
      launchedAt: "2026-10-13T09:20:00.000Z",
      verifiedAt: "2026-10-13T09:31:00.000Z",
      terminatedAt: "2026-10-13T09:40:00.000Z",
      ...patch,
    },
    checks: CHECKS.map((check) => ({ id: check.id, outcome: "pass", detail: "" })),
    notes: "",
  });

  it("measures recovery time to the verified service, not to the launched instance", () => {
    expect(summarize(record())).toMatchObject({
      rtoSeconds: 1860,
      rpoSeconds: 90,
      rto: "met",
      rpo: "met",
      cleanedUp: true,
    });
  });

  it("reports an objective as not measured when a moment is missing", () => {
    expect(summarize(record({ verifiedAt: null }))).toMatchObject({
      rtoSeconds: null,
      rto: "not-measured",
    });
  });

  it("misses the objective when verification took too long", () => {
    expect(summarize(record({ verifiedAt: "2026-10-13T10:30:00.000Z" })).rto).toBe("missed");
  });

  it("is not cleaned up while the drill instance exists", () => {
    expect(summarize(record({ terminatedAt: null })).cleanedUp).toBe(false);
  });

  it("starts from a template in which nothing has happened yet", () => {
    const empty = v.parse(drillRecordSchema, template);
    expect(summarize(empty)).toMatchObject({ rto: "not-measured", rpo: "not-measured" });
    expect(summarize(empty).verdict.result).toBe("incomplete");
  });

  it("refuses a time that is not UTC", () => {
    const local = {
      ...template,
      timeline: { ...template.timeline, declaredAt: "2026-10-13T18:00:00+09:00" },
    };
    expect(v.safeParse(drillRecordSchema, local).success).toBe(false);
  });
});
