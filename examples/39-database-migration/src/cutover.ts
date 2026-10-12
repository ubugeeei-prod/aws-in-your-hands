// The decisions of a cutover as pure functions. They read numbers a person or
// a script collected; they call nothing.

import * as v from "valibot";

// #region phases
/** The order of a cutover, and which database may accept a write in each phase. */
export const phases = [
  { name: "replicating", writes: "source" },
  { name: "frozen", writes: "none" },
  { name: "verified", writes: "none" },
  { name: "switched", writes: "target" },
] as const;

export type Phase = (typeof phases)[number]["name"];

/** Never both: there is no phase in which the source and the target accept writes. */
export function writesGoTo(phase: Phase): "source" | "target" | "none" {
  return phases.find((candidate) => candidate.name === phase)?.writes ?? "none";
}
// #endregion phases

// #region input
// The states AWS DMS reports per table when data validation is on.
export const validationStates = [
  "Not enabled",
  "Pending records",
  "Mismatched records",
  "Suspended records",
  "No primary key",
  "Table error",
  "Validated",
  "Error",
  "Pending validation",
  "Preparing table",
  "Pending revalidation",
] as const;

const seconds = v.pipe(v.number(), v.finite(), v.minValue(0));
const count = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

export const observationSchema = v.strictObject({
  /** CDCLatencySource and CDCLatencyTarget. Null when the metric had no datapoint. */
  cdcLatencySourceSeconds: v.nullable(seconds),
  cdcLatencyTargetSeconds: v.nullable(seconds),
  /** Is the source refusing writes, and was that checked by trying one? */
  sourceReadOnly: v.boolean(),
  /** Transactions still open on the source that have written something. */
  openWriteTransactions: count,
  tables: v.pipe(
    v.array(
      v.strictObject({
        name: v.string(),
        validationState: v.picklist(validationStates),
        /** The result of this chapter's own count-and-digest comparison, if it was run. */
        comparedEqual: v.optional(v.boolean()),
      }),
    ),
    v.minLength(1),
  ),
  sequencesAdvanced: v.boolean(),
  missingSecondaryObjects: v.array(v.string()),
  /** The replication is stopped, so nothing will be applied to the target after the switch. */
  replicationStopped: v.boolean(),
});

export type Observation = v.InferOutput<typeof observationSchema>;

export type Decision = { ok: boolean; blockers: string[] };
// #endregion input

// #region freeze
/**
 * May writes be stopped now? The outage starts here and lasts until the last
 * change has been applied, so the lag at this moment is a floor for its length.
 */
export function mayFreeze(observation: Observation, maxLatencySeconds: number): Decision {
  const blockers: string[] = [];
  for (const [name, value] of [
    ["CDCLatencySource", observation.cdcLatencySourceSeconds],
    ["CDCLatencyTarget", observation.cdcLatencyTargetSeconds],
  ] as const) {
    if (value === null) {
      blockers.push(`${name} has no datapoint: the lag is unknown, not zero`);
    } else if (value > maxLatencySeconds) {
      blockers.push(
        `${name} is ${value}s, above the ${maxLatencySeconds}s chosen for this cutover`,
      );
    }
  }
  for (const table of observation.tables) {
    if (
      ["Mismatched records", "Table error", "Error", "Suspended records"].includes(
        table.validationState,
      )
    ) {
      blockers.push(`${table.name}: validation reports "${table.validationState}"`);
    }
  }
  if (observation.missingSecondaryObjects.length > 0) {
    blockers.push(`the target lacks: ${observation.missingSecondaryObjects.join(", ")}`);
  }
  return { ok: blockers.length === 0, blockers };
}
// #endregion freeze

// #region switch
/** May the application be pointed at the target? Every answer must be yes; none is assumed. */
export function maySwitch(observation: Observation): Decision {
  const blockers: string[] = [];
  if (!observation.sourceReadOnly) {
    blockers.push("the source still accepts writes");
  }
  if (observation.openWriteTransactions > 0) {
    blockers.push(
      `${observation.openWriteTransactions} write transaction(s) still open on the source`,
    );
  }
  for (const [name, value] of [
    ["CDCLatencySource", observation.cdcLatencySourceSeconds],
    ["CDCLatencyTarget", observation.cdcLatencyTargetSeconds],
  ] as const) {
    if (value !== 0) {
      blockers.push(`${name} is ${value === null ? "unknown" : `${value}s`}, not 0`);
    }
  }
  for (const table of observation.tables) {
    const validated = table.validationState === "Validated";
    // DMS cannot validate these. Our own comparison has to stand in, and it has to have run.
    const uncheckedByDms = ["Not enabled", "No primary key"].includes(table.validationState);
    if (!validated && !(uncheckedByDms && table.comparedEqual === true)) {
      blockers.push(`${table.name}: validation is "${table.validationState}"`);
    }
    if (table.comparedEqual === false) {
      blockers.push(`${table.name}: counts or digests differ`);
    }
  }
  if (!observation.sequencesAdvanced) {
    blockers.push("the target's sequences were not advanced");
  }
  if (observation.missingSecondaryObjects.length > 0) {
    blockers.push(`the target lacks: ${observation.missingSecondaryObjects.join(", ")}`);
  }
  if (!observation.replicationStopped) {
    blockers.push("the replication is still running and would overwrite writes made on the target");
  }
  return { ok: blockers.length === 0, blockers };
}
// #endregion switch
