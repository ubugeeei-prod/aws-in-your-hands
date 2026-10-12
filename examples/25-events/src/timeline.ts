import * as v from "valibot";

import { type NoteEvent, noteEventSchema } from "./contract.ts";

// #region timeline
// The latest thing known about each note. A projection: it can be thrown
// away and rebuilt from the events.
export const timelineEntrySchema = v.object({
  noteId: v.string(),
  lastEvent: v.picklist(["NoteCreated", "NoteUpdated", "NoteDeleted"]),
  /** Orders the events of one note. */
  rank: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  occurredAt: v.string(),
  eventId: v.string(),
});
export type TimelineEntry = v.InferOutput<typeof timelineEntrySchema>;

export type TimelineStore = {
  /** Writes unless an entry of the same or a higher rank is there. Check and write are one step. */
  putIfNewer(owner: string, entry: TimelineEntry): Promise<"written" | "not_newer">;
  get(owner: string, noteId: string): Promise<TimelineEntry | undefined>;
};

// A deletion is the last thing that happens to a note, whatever version it had.
const DELETED = Number.MAX_SAFE_INTEGER;
export const rankOf = (event: NoteEvent): number =>
  event.type === "NoteDeleted" ? DELETED : event.noteVersion;

/**
 * Safe to hand the same event twice, and safe to hand events out of order:
 * an older one never replaces a newer one.
 */
export function createTimelineConsumer(store: TimelineStore) {
  return async (detail: unknown): Promise<"written" | "not_newer"> => {
    const event = v.parse(noteEventSchema, detail);
    return store.putIfNewer(event.owner, {
      noteId: event.noteId,
      lastEvent: event.type,
      rank: rankOf(event),
      occurredAt: event.occurredAt,
      eventId: event.id,
    });
  };
}
// #endregion timeline

export class InMemoryTimelineStore implements TimelineStore {
  readonly #entries = new Map<string, TimelineEntry>();

  async putIfNewer(owner: string, entry: TimelineEntry) {
    const key = `${owner}/${entry.noteId}`;
    const existing = this.#entries.get(key);
    // No `await` between the read and the write: one step, as the condition is in DynamoDB.
    if (existing !== undefined && existing.rank >= entry.rank) {
      return "not_newer" as const;
    }
    this.#entries.set(key, entry);
    return "written" as const;
  }

  async get(owner: string, noteId: string) {
    return this.#entries.get(`${owner}/${noteId}`);
  }
}
