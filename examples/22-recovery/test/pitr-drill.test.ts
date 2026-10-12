import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { type DrillRecord, drillRecordSchema, mark, summarize } from "../src/drill.ts";
import { planTableRestore } from "../src/pitr.ts";

const now = new Date("2026-10-12T09:30:15.250Z");
const backups = {
  enabled: true,
  earliestRestorable: new Date("2026-10-01T00:00:00Z"),
  latestRestorable: new Date("2026-10-12T09:25:00Z"),
};

describe("planTableRestore", () => {
  it("restores into a new table whose name says when and from what", () => {
    const plan = planTableRestore({
      sourceTableName: "Notes",
      backups,
      at: new Date("2026-10-12T09:00:00Z"),
      now,
    });
    expect(plan).toEqual({
      ok: true,
      targetTableName: "Notes-restored-20261012T093015Z",
      input: {
        SourceTableName: "Notes",
        TargetTableName: "Notes-restored-20261012T093015Z",
        RestoreDateTime: new Date("2026-10-12T09:00:00Z"),
      },
    });
  });

  it("asks for the latest restorable time when no point is given", () => {
    const plan = planTableRestore({ sourceTableName: "Notes", backups, now });
    expect(plan).toMatchObject({ ok: true, input: { UseLatestRestorableTime: true } });
    expect(plan.ok && "RestoreDateTime" in plan.input).toBe(false);
  });

  it.each([
    ["before the window", new Date("2026-09-30T23:59:59Z")],
    ["after the latest restorable time", new Date("2026-10-12T09:26:00Z")],
  ])("refuses a point %s", (_name, at) => {
    expect(planTableRestore({ sourceTableName: "Notes", backups, at, now })).toMatchObject({
      ok: false,
    });
  });

  it("refuses when point-in-time recovery is off", () => {
    const off = { enabled: false, earliestRestorable: undefined, latestRestorable: undefined };
    expect(planTableRestore({ sourceTableName: "Notes", backups: off, now })).toMatchObject({
      ok: false,
    });
  });

  it("refuses to restore from a restored table", () => {
    const plan = planTableRestore({
      sourceTableName: "Notes-restored-20261012T093015Z",
      backups,
      now,
    });
    expect(plan).toMatchObject({ ok: false });
  });
});

const template = (): DrillRecord =>
  drillRecordSchema.parse(
    JSON.parse(readFileSync(new URL("../drill/record.template.json", import.meta.url), "utf8")),
  );

describe("the drill record", () => {
  it("ships empty: no time and no count is filled in", () => {
    const record = template();
    expect(Object.values(record.timeline).every((value) => value === null)).toBe(true);
    expect(Object.values(record.counts).every((value) => value === null)).toBe(true);
  });

  it("reports nothing it cannot compute", () => {
    const summary = summarize(template());
    expect(summary).toMatchObject({
      rtoSeconds: null,
      rpoSeconds: null,
      tableRestoreSeconds: null,
      skewSeconds: null,
    });
    expect(summary.missing).toHaveLength(11);
  });

  it("computes the times from the moments that were recorded", () => {
    let record = template();
    const moments = {
      tableRestorePoint: "2026-10-12T09:00:00Z",
      objectRestorePoint: "2026-10-12T08:58:30Z",
      accidentAt: "2026-10-12T09:04:00Z",
      detectedAt: "2026-10-12T09:10:00Z",
      restoreRequestedAt: "2026-10-12T09:15:00Z",
      tableActiveAt: "2026-10-12T09:27:30Z",
      serviceConfirmedAt: "2026-10-12T09:44:00Z",
    } as const;
    for (const [name, at] of Object.entries(moments)) {
      record = mark(record, name as keyof typeof moments, new Date(at));
    }

    expect(summarize(record)).toEqual({
      rtoSeconds: 2400,
      rpoSeconds: 240,
      detectionSeconds: 360,
      tableRestoreSeconds: 750,
      skewSeconds: 90,
      missing: ["lastGoodWriteAt", "objectsRestoredAt", "verifiedAt", "cutoverAt"],
    });
  });

  it("does not let a recorded moment be rewritten", () => {
    const record = mark(template(), "accidentAt", now);
    expect(() => mark(record, "accidentAt", new Date())).toThrow("already recorded");
  });
});
