import * as v from "valibot";

import { type EventRecord, eventRecordSchema } from "./events.ts";

/**
 * Picks this app's event lines out of a log group and drops repeated
 * deliveries of one event. Lambda's own START, END and REPORT lines, and
 * anything else that is not an event record, are skipped.
 */
export function parseLoggedEvents(messages: string[]): EventRecord[] {
  const byId = new Map<string, EventRecord>();
  for (const message of messages) {
    // With Lambda's text log format the JSON follows a timestamp and request ID.
    const start = message.indexOf("{");
    if (start === -1) {
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(message.slice(start));
    } catch {
      continue;
    }
    const parsed = v.safeParse(eventRecordSchema, json);
    if (parsed.success && !byId.has(parsed.output.eventId)) {
      byId.set(parsed.output.eventId, parsed.output);
    }
  }
  return [...byId.values()].toSorted((a, b) => a.eventTime.localeCompare(b.eventTime));
}
