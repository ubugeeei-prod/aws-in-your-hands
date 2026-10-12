import * as v from "valibot";

import { parseIvsEvent, toRecord } from "./events.ts";

// #region handle
export type Output = (line: string) => void;

/** Returns false for an event it could not read. It never throws on bad input. */
export function handleEvent(event: unknown, now: Date, write: Output): boolean {
  try {
    write(JSON.stringify(toRecord(parseIvsEvent(event), now)));
    return true;
  } catch (error) {
    if (!v.isValiError(error)) {
      throw error;
    }
    // A retry cannot fix an unexpected shape, so log it and finish normally
    // instead of failing the invocation.
    // Where and why, not Valibot's whole issue: each one carries a copy of the event.
    const issues = error.issues.map((issue) => ({
      path: v.getDotPath(issue) ?? "",
      message: issue.message,
    }));
    write(JSON.stringify({ kind: "ivs-event-unreadable", issues, event }));
    return false;
  }
}
// #endregion handle

export const handler = async (event: unknown): Promise<void> => {
  handleEvent(event, new Date(), (line) => console.log(line));
};
