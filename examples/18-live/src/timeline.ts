import type { StreamStatus } from "./stream.ts";

// #region belief
export type SeenEvent = { eventId: string; name: string; streamId: string | null };

export type StreamBelief = "starting" | "live" | "ended";

const starts = new Set(["Stream Start"]);
const ends = new Set(["Stream End", "Session Ended"]);

/**
 * What the events received so far say about each stream. It depends on which
 * events arrived, never on their order or how many times each was delivered.
 */
export function believe(events: SeenEvent[]): Map<string, StreamBelief> {
  const names = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.streamId !== null) {
      names.set(event.streamId, (names.get(event.streamId) ?? new Set()).add(event.name));
    }
  }
  const beliefs = new Map<string, StreamBelief>();
  for (const [streamId, seen] of names) {
    const ended = [...seen].some((name) => ends.has(name));
    const started = [...seen].some((name) => starts.has(name));
    // A stream ID is never reused, so an end is final whatever arrives after it.
    beliefs.set(streamId, ended ? "ended" : started ? "live" : "starting");
  }
  return beliefs;
}
// #endregion belief

// #region reconcile
export type Disagreement =
  | "end event missing or late"
  | "start event missing or late"
  | "ended in events, live in GetStream";

export type Reconciliation = { agrees: true } | { agrees: false; reason: Disagreement; streamId: string };

/** Events are hints, delivered best effort. GetStream is the answer. */
export function reconcile(beliefs: Map<string, StreamBelief>, actual: StreamStatus): Reconciliation {
  if (actual.state === "live") {
    const belief = beliefs.get(actual.streamId);
    if (belief === "ended") {
      return { agrees: false, reason: "ended in events, live in GetStream", streamId: actual.streamId };
    }
    if (belief !== "live") {
      return { agrees: false, reason: "start event missing or late", streamId: actual.streamId };
    }
  }
  for (const [streamId, belief] of beliefs) {
    if (belief === "live" && (actual.state === "offline" || actual.streamId !== streamId)) {
      return { agrees: false, reason: "end event missing or late", streamId };
    }
  }
  return { agrees: true };
}
// #endregion reconcile
