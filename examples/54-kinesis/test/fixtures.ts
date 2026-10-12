import type { LocalStream } from "../src/local-stream.ts";
import type { Entry } from "../src/producer.ts";
import { encode, partitionKeyOf, type Revision } from "../src/revision.ts";

export const OWNER = "user-1";

export const revision = (
  noteId: string,
  version: number,
  kind: Revision["kind"] = version === 1 ? "created" : "edited",
): Revision => ({
  noteId,
  owner: OWNER,
  version,
  kind,
  at: new Date(Date.UTC(2026, 9, 13, 0, 0, version)).toISOString(),
});

/** Versions 1 to `count` of one note, in order. */
export const revisionsOf = (noteId: string, count: number): Revision[] =>
  Array.from({ length: count }, (_, index) => revision(noteId, index + 1));

export const entryOf = (value: Revision): Entry => ({
  partitionKey: partitionKeyOf(value),
  data: encode(value),
});

/** Bytes that are no revision, filed under a key of their own. */
export const poison = (partitionKey = "poison"): Entry => ({
  partitionKey,
  data: new TextEncoder().encode("{not json"),
});

/** The first note ID of the form `<prefix>-<n>` that the stream sends to the given shard. */
export function noteIn(stream: LocalStream, shardId: string, prefix = "note"): string {
  for (let index = 0; index < 1000; index += 1) {
    const candidate = `${prefix}-${index}`;
    if (stream.shardFor(candidate) === shardId) {
      return candidate;
    }
  }
  throw new Error(`no key found for ${shardId}`);
}
