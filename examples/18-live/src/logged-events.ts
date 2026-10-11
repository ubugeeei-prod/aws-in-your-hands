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
    const parsed = eventRecordSchema.safeParse(json);
    if (parsed.success && !byId.has(parsed.data.eventId)) {
      byId.set(parsed.data.eventId, parsed.data);
    }
  }
  return [...byId.values()].toSorted((a, b) => a.eventTime.localeCompare(b.eventTime));
}
