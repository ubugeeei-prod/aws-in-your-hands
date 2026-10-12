import { appliedSk, parseTagSk, tagCountSk, TTL_ATTRIBUTE } from "./keys.ts";
import type { Table } from "./table.ts";

// #region change
/** One stream record, reduced to what the count needs. */
export type Change = {
  eventId: string;
  sequenceNumber: string;
  eventName: "INSERT" | "MODIFY" | "REMOVE";
  pk: string;
  sk: string;
};

/** Only a tag item appearing or disappearing moves a count. Everything else in the table is ignored. */
export function tagDelta(change: Change): { tag: string; delta: 1 | -1 } | undefined {
  const parsed = parseTagSk(change.sk);
  if (parsed === undefined || change.eventName === "MODIFY") {
    return undefined;
  }
  return { tag: parsed.tag, delta: change.eventName === "INSERT" ? 1 : -1 };
}
// #endregion change

// A record can be retried for as long as the stream keeps it: 24 hours. The marker outlives that.
export const MARKER_TTL_SECONDS = 48 * 60 * 60;

// #region apply
export type Applied = "applied" | "duplicate" | "ignored" | "busy";

export async function applyChange(table: Table, change: Change, now: Date): Promise<Applied> {
  const counted = tagDelta(change);
  if (counted === undefined) {
    return "ignored";
  }
  const result = await table.transact([
    {
      // Lambda delivers a record at least once. The marker and the count change
      // together or not at all, so a second delivery finds the marker and adds nothing.
      kind: "put",
      item: {
        pk: change.pk,
        sk: appliedSk(change.eventId),
        [TTL_ATTRIBUTE]: Math.floor(now.getTime() / 1000) + MARKER_TTL_SECONDS,
      },
      condition: { kind: "not_exists" },
    },
    {
      kind: "update",
      key: { pk: change.pk, sk: tagCountSk(counted.tag) },
      add: { count: counted.delta },
    },
  ]);
  if (result.ok) {
    return "applied";
  }
  return result.reasons[0] === "condition_failed" ? "duplicate" : "busy";
}
// #endregion apply

// #region project
/**
 * Applies a batch in order and stops at the first record that could not be
 * applied. Lambda retries from that record on, so going further would be redone anyway.
 */
export async function project(
  table: Table,
  changes: Change[],
  now: Date,
): Promise<{ applied: number; duplicates: number; failedAt: string | undefined }> {
  let applied = 0;
  let duplicates = 0;
  for (const change of changes) {
    const result = await applyChange(table, change, now);
    if (result === "busy") {
      return { applied, duplicates, failedAt: change.sequenceNumber };
    }
    applied += result === "applied" ? 1 : 0;
    duplicates += result === "duplicate" ? 1 : 0;
  }
  return { applied, duplicates, failedAt: undefined };
}
// #endregion project
