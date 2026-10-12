// What the page shows and does, decided from what the meeting session reports.
// No SDK import here, so this file runs in a plain Node test.

// #region signal
export type CallSignal =
  | { kind: "connecting"; reconnecting: boolean }
  | { kind: "started" }
  /** `code` is the name of a MeetingSessionStatusCode, such as "Left". */
  | { kind: "stopped"; code: string };

export type CallView =
  | { name: "idle" }
  | { name: "connecting" }
  | { name: "reconnecting" }
  | { name: "in-call" }
  | { name: "ended"; message: string };

export function viewFor(signal: CallSignal): CallView {
  switch (signal.kind) {
    case "connecting":
      return { name: signal.reconnecting ? "reconnecting" : "connecting" };
    case "started":
      return { name: "in-call" };
    case "stopped":
      return {
        name: "ended",
        message: endings[signal.code] ?? `The call stopped (${signal.code}).`,
      };
  }
}

const endings: Record<string, string> = {
  Left: "You left the call.",
  AudioJoinedFromAnotherDevice:
    "This seat was taken over somewhere else with the same join token. If that was not you, join again: it ends the other connection.",
  AudioAttendeeRemoved: "Your seat was ended by the room.",
  AudioAuthenticationRejected: "The join token was not accepted. Join again.",
  MeetingEnded: "The call has ended.",
  AudioCallAtCapacity: "The call is full.",
};
// #endregion signal

// #region release
// After a stop, should the page tell the API that the user has left? Leaving ends the
// attendee, so it must not happen when the seat has merely moved to another device.
const seatAlreadyGone = new Set(["AudioAttendeeRemoved", "MeetingEnded"]);

export function shouldLeave(code: string): boolean {
  return code !== "AudioJoinedFromAnotherDevice" && !seatAlreadyGone.has(code);
}
// #endregion release

// #region roster
/** Who is connected right now, as the media service reports it. The table only knows who holds a seat. */
export function withPresence(
  present: readonly string[],
  user: string,
  isPresent: boolean,
): string[] {
  const others = present.filter((candidate) => candidate !== user);
  return isPresent ? [...others, user].toSorted() : others;
}
// #endregion roster
