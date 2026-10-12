import type { Classification } from "./classify.ts";
import type { HealthEvent, Status } from "./event.ts";

// #region entry
/** What is remembered about one event of one account. */
export type Entry = {
  /** The state a notification was, or is being, sent for. */
  revision: string;
  /** When AWS last updated the event, in milliseconds. Orders the messages about it. */
  clock: number;
  status: Status;
  /** False from the moment the notification is claimed until SNS has accepted it. */
  notified: boolean;
  claimedAt: number;
  /** Counts writes, so that a write can require that nobody else wrote in between. */
  writes: number;
};

export type Version = Pick<Entry, "revision" | "clock" | "status">;

/** An event ARN is not unique to an account, and an organization's feed carries many accounts. */
export const keyOf = (event: HealthEvent): string =>
  `${event.detail.affectedAccount}#${event.detail.eventArn}`;

/**
 * The part of an event whose change is worth a message. An incident is re-announced on every
 * update AWS posts. Anything else only when its status or its dates move: a planned change
 * is updated again and again as resources are ticked off.
 */
export function versionOf(event: HealthEvent, kind: Classification["kind"]): Version {
  const { statusCode, startTime, endTime, lastUpdatedTime } = event.detail;
  const dates = `${startTime}|${endTime ?? ""}`;
  return {
    revision:
      kind === "incident"
        ? `${statusCode}|${dates}|${lastUpdatedTime ?? ""}`
        : `${statusCode}|${dates}`,
    // Samples in the documentation leave lastUpdatedTime out. The delivery time stands in.
    clock: lastUpdatedTime ?? event.time,
    status: statusCode,
  };
}
// #endregion entry

// #region decide
export type Decision =
  | { do: "announce"; change: "new" | "update" | "closed" | "retry" }
  /** A newer message that changes nothing worth sending. Only the clock moves. */
  | { do: "advance" }
  | { do: "skip"; why: "duplicate" | "stale" | "in-flight" };

/** How long a claimed notification is left alone. Longer than the function's timeout, shorter than Lambda's first retry (one minute). */
export const CLAIM_MS = 30_000;

const RANK = { upcoming: 0, open: 1, closed: 2 } as const satisfies Record<Status, number>;

export function decide(stored: Entry | undefined, incoming: Version, now: number): Decision {
  if (stored === undefined) {
    return { do: "announce", change: "new" };
  }
  if (incoming.revision === stored.revision) {
    if (!stored.notified) {
      // Someone claimed this and never finished. After a while, it is ours to send.
      return now - stored.claimedAt < CLAIM_MS
        ? { do: "skip", why: "in-flight" }
        : { do: "announce", change: "retry" };
    }
    return incoming.clock > stored.clock ? { do: "advance" } : { do: "skip", why: "duplicate" };
  }
  const older =
    incoming.clock < stored.clock ||
    // The same second: an event does not go back from closed to open.
    (incoming.clock === stored.clock && RANK[incoming.status] < RANK[stored.status]);
  if (older) {
    return { do: "skip", why: "stale" };
  }
  return {
    do: "announce",
    change: incoming.status === "closed" && stored.status !== "closed" ? "closed" : "update",
  };
}
// #endregion decide

// #region ledger
export type Ledger = {
  read(key: string): Promise<Entry | undefined>;
  /** Writes `next` only if the stored entry is still `previous`. False when it is not. */
  write(key: string, next: Entry, previous: Entry | undefined): Promise<boolean>;
};

export function memoryLedger(): Ledger & { entries: Map<string, Entry> } {
  const entries = new Map<string, Entry>();
  return {
    entries,
    read: async (key) => entries.get(key),
    write: async (key, next, previous) => {
      if (entries.get(key)?.writes !== previous?.writes) {
        return false;
      }
      entries.set(key, next);
      return true;
    },
  };
}
// #endregion ledger
