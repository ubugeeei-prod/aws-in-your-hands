import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import {
  type Observation,
  mayFreeze,
  maySwitch,
  observationSchema,
  phases,
  writesGoTo,
} from "../src/cutover.ts";
import { lobMaxSizeKb, replicationSettings } from "../src/task-settings.ts";

const ready: Observation = {
  cdcLatencySourceSeconds: 0,
  cdcLatencyTargetSeconds: 0,
  sourceReadOnly: true,
  openWriteTransactions: 0,
  tables: [
    { name: "app.owners", validationState: "Validated" },
    { name: "app.notes", validationState: "Validated", comparedEqual: true },
  ],
  sequencesAdvanced: true,
  missingSecondaryObjects: [],
  replicationStopped: true,
};

describe("the phases", () => {
  it("never let both databases accept writes", () => {
    expect(phases.map((phase) => writesGoTo(phase.name))).toEqual([
      "source",
      "none",
      "none",
      "target",
    ]);
  });
});

describe("mayFreeze", () => {
  const replicating = { ...ready, sourceReadOnly: false, replicationStopped: false };

  it("allows stopping writes when both latencies are under the chosen limit", () => {
    const observation = { ...replicating, cdcLatencySourceSeconds: 2, cdcLatencyTargetSeconds: 4 };
    expect(mayFreeze(observation, 5)).toEqual({ ok: true, blockers: [] });
  });

  it("treats a missing datapoint as unknown lag, not as none", () => {
    const decision = mayFreeze({ ...replicating, cdcLatencyTargetSeconds: null }, 5);
    expect(decision.ok).toBe(false);
    expect(decision.blockers[0]).toContain("unknown");
  });

  it("refuses while the target is behind, validation has found mismatches, or an index is missing", () => {
    const decision = mayFreeze(
      {
        ...replicating,
        cdcLatencyTargetSeconds: 600,
        tables: [{ name: "app.notes", validationState: "Mismatched records" }],
        missingSecondaryObjects: ["index notes.notes_owner_created_idx"],
      },
      5,
    );
    expect(decision.blockers).toHaveLength(3);
  });
});

describe("maySwitch", () => {
  it("says yes only when everything was checked", () => {
    expect(maySwitch(ready)).toEqual({ ok: true, blockers: [] });
  });

  const cases: [string, Partial<Observation>][] = [
    ["the source still takes writes", { sourceReadOnly: false }],
    ["a write transaction is open", { openWriteTransactions: 1 }],
    ["lag is not zero", { cdcLatencyTargetSeconds: 1 }],
    ["lag is unknown", { cdcLatencySourceSeconds: null }],
    ["sequences were not advanced", { sequencesAdvanced: false }],
    ["an index is missing", { missingSecondaryObjects: ["index notes.x"] }],
    ["the replication still runs", { replicationStopped: false }],
  ];
  it.each(cases)("refuses when %s", (_, change) => {
    expect(maySwitch({ ...ready, ...change }).ok).toBe(false);
  });

  it("does not take a table DMS could not validate on trust", () => {
    const unvalidated = (comparedEqual?: boolean): Observation => ({
      ...ready,
      tables: [
        {
          name: "app.audit_log",
          validationState: "No primary key",
          ...(comparedEqual === undefined ? {} : { comparedEqual }),
        },
      ],
    });
    expect(maySwitch(unvalidated()).ok).toBe(false);
    expect(maySwitch(unvalidated(false)).ok).toBe(false);
    expect(maySwitch(unvalidated(true)).ok).toBe(true);
  });

  it("refuses a table whose validation is still pending", () => {
    const pending = {
      ...ready,
      tables: [{ name: "app.notes", validationState: "Pending records" as const }],
    };
    expect(maySwitch(pending).blockers).toEqual(['app.notes: validation is "Pending records"']);
  });
});

describe("the observation schema", () => {
  it("refuses a negative latency, a state DMS does not report, and an empty table list", () => {
    const bad = [
      { ...ready, cdcLatencySourceSeconds: -1 },
      { ...ready, tables: [{ name: "t", validationState: "Fine" }] },
      { ...ready, tables: [] },
    ];
    for (const input of bad) {
      expect(v.safeParse(observationSchema, input).success).toBe(false);
    }
    expect(v.safeParse(observationSchema, ready).success).toBe(true);
  });
});

describe("the replication settings", () => {
  it("leave room for the longest note body the schema allows", () => {
    const longestBodyBytes = 10_000 * 4;
    expect(lobMaxSizeKb * 1024).toBeGreaterThanOrEqual(longestBodyBytes);
    expect(replicationSettings.TargetMetadata.LobMaxSize).toBe(lobMaxSizeKb);
  });

  it("never let DMS drop or recreate the target's tables", () => {
    expect(replicationSettings.FullLoadSettings.TargetTablePrepMode).toBe("DO_NOTHING");
  });
});
