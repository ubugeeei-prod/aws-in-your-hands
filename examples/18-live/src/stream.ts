import * as v from "valibot";

// #region schema
// The `stream` object of a GetStream response. Every field is optional in the
// API reference, so the ones this code depends on are required here.
const liveStreamSchema = v.object({
  channelArn: v.pipe(v.string(), v.minLength(1)),
  streamId: v.pipe(v.string(), v.regex(/^st-[a-zA-Z0-9]+$/)),
  state: v.picklist(["LIVE", "OFFLINE"]),
  health: v.picklist(["HEALTHY", "STARVING", "UNKNOWN"]),
  // The SDK hands over a Date. The same response as JSON carries text.
  startTime: v.union([
    v.date(),
    v.pipe(
      v.string(),
      v.isoTimestamp(),
      v.transform((text) => new Date(text)),
    ),
  ]),
  viewerCount: v.pipe(v.number(), v.integer()),
});
// #endregion schema

// #region status
export type StreamStatus =
  | { state: "offline" }
  | {
      state: "live";
      streamId: string;
      health: "HEALTHY" | "STARVING" | "UNKNOWN";
      startedAt: Date;
      /** null when IVS could not count in time (the API reports that as -1). */
      viewerCount: number | null;
    };

/** What a GetStream call produced: a response body, or the name of the error it threw. */
export type GetStreamOutcome =
  | { kind: "response"; stream: unknown }
  | { kind: "error"; name: string };

export function interpretGetStream(outcome: GetStreamOutcome): StreamStatus {
  if (outcome.kind === "error") {
    // Offline is reported as this error, not as a state. Any other error is
    // "unknown", and unknown must never be shown as "stopped".
    if (outcome.name === "ChannelNotBroadcasting") {
      return { state: "offline" };
    }
    throw new Error(
      `GetStream failed with ${outcome.name}: the stream state is unknown, not offline`,
    );
  }
  const stream = v.parse(liveStreamSchema, outcome.stream);
  if (stream.state === "OFFLINE") {
    return { state: "offline" };
  }
  return {
    state: "live",
    streamId: stream.streamId,
    health: stream.health,
    startedAt: stream.startTime,
    viewerCount: stream.viewerCount < 0 ? null : stream.viewerCount,
  };
}
// #endregion status

// #region billed
/** An estimate from startTime. The pricing page rounds input up to the minute. */
export function inputMinutesSoFar(startedAt: Date, now: Date): number {
  return Math.max(1, Math.ceil((now.getTime() - startedAt.getTime()) / 60_000));
}

export function describeStatus(status: StreamStatus, now: Date): string {
  if (status.state === "offline") {
    return "OFFLINE  nothing is being ingested, so no input time is accruing";
  }
  const viewers =
    status.viewerCount === null
      ? "viewer count timed out"
      : `${status.viewerCount} concurrent views`;
  return [
    `LIVE     ${status.streamId}, started ${status.startedAt.toISOString()}`,
    `         input is billed for every minute it stays live: ${inputMinutesSoFar(status.startedAt, now)} so far`,
    `         health ${status.health}, ${viewers}`,
  ].join("\n");
}
// #endregion billed
