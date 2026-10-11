// What the page shows, decided from what the player reports. No SDK import
// here, so this file runs in a plain Node test.

// #region view
export type PlayerSignal =
  | { kind: "state"; state: "Idle" | "Ready" | "Buffering" | "Playing" | "Ended" }
  | { kind: "error"; type: string; code: number; message: string };

export type View =
  | { name: "connecting" }
  | { name: "paused" }
  | { name: "playing" }
  | { name: "buffering" }
  /** Not broadcasting right now. The page asks again after `retryInMs`. */
  | { name: "offline"; retryInMs: number }
  | { name: "full" }
  | { name: "failed"; message: string };

/** `attempt` counts consecutive tries that found the channel offline. */
export function viewFor(signal: PlayerSignal, attempt: number): View {
  if (signal.kind === "error") {
    if (signal.type === "ErrorNotAvailable" && signal.code === 404) {
      // An offline channel and a mistyped URL look the same from here.
      return { name: "offline", retryInMs: retryDelayMs(attempt) };
    }
    if (signal.type === "ErrorNotAvailable" && signal.code === 429) {
      return { name: "full" };
    }
    return { name: "failed", message: `${signal.type} ${signal.code}: ${signal.message}` };
  }
  switch (signal.state) {
    case "Playing":
      return { name: "playing" };
    case "Buffering":
      return { name: "buffering" };
    case "Ended":
      return { name: "offline", retryInMs: retryDelayMs(attempt) };
    case "Ready":
      return { name: "connecting" };
    case "Idle":
      return { name: "paused" };
  }
}
// #endregion view

// #region retry
// Every open tab retries on its own, so the wait grows and then stays at a minute.
export function retryDelayMs(attempt: number): number {
  return Math.min(60_000, 5_000 * 2 ** Math.max(0, attempt));
}
// #endregion retry
