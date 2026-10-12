import { ZodError } from "zod";

import { parseIvsEvent, toRecord } from "./events.ts";

// #region handle
export type Output = (line: string) => void;

/** Returns false for an event it could not read. It never throws on bad input. */
export function handleEvent(event: unknown, now: Date, write: Output): boolean {
  try {
    write(JSON.stringify(toRecord(parseIvsEvent(event), now)));
    return true;
  } catch (error) {
    if (!(error instanceof ZodError)) {
      throw error;
    }
    // A retry cannot fix an unexpected shape, so log it and finish normally
    // instead of failing the invocation.
    write(JSON.stringify({ kind: "ivs-event-unreadable", issues: error.issues, event }));
    return false;
  }
}
// #endregion handle

export const handler = async (event: unknown): Promise<void> => {
  handleEvent(event, new Date(), (line) => console.log(line));
};
