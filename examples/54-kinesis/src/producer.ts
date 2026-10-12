// #region types
export type Entry = { partitionKey: string; data: Uint8Array };
export type PutOutcome = { shardId: string; sequenceNumber: string } | { errorCode: string };

/** PutRecords, reduced to what the producer needs. The stream and the SDK adapter both fit. */
export type StreamWriter = {
  putRecords(entries: Entry[]): Promise<{ records: PutOutcome[] }>;
};

/** One PutRecords request, as of 2026-10-13: 500 records and 10 MiB with the partition keys. */
export const REQUEST_LIMIT = { records: 500, bytes: 10 * 1024 * 1024 } as const;
// #endregion types

const sizeOf = (entry: Entry): number =>
  entry.data.byteLength + Buffer.byteLength(entry.partitionKey);

// #region plan
/**
 * Splits entries into requests so that no request holds two entries of one
 * partition key. PutRecords accepts or refuses each entry by itself, so two
 * revisions of a note in one request can end up stored in the other order.
 * Apart, the second is not sent until the first is in the stream.
 */
export function planRounds(entries: Entry[]): Entry[][] {
  const rounds: { entries: Entry[]; bytes: number }[] = [];
  const lastRoundOf = new Map<string, number>();
  for (const entry of entries) {
    const size = sizeOf(entry);
    if (size > REQUEST_LIMIT.bytes) {
      throw new Error(`a record of ${size} bytes does not fit in one request`);
    }
    const fits = (round: { entries: Entry[]; bytes: number } | undefined): boolean =>
      round === undefined ||
      (round.entries.length < REQUEST_LIMIT.records && round.bytes + size <= REQUEST_LIMIT.bytes);
    // Never before the round that holds this key's previous entry, nor in it.
    let index = (lastRoundOf.get(entry.partitionKey) ?? -1) + 1;
    while (!fits(rounds[index])) {
      index += 1;
    }
    const round = (rounds[index] ??= { entries: [], bytes: 0 });
    round.entries.push(entry);
    round.bytes += size;
    lastRoundOf.set(entry.partitionKey, index);
  }
  return rounds.map((round) => round.entries);
}
// #endregion plan

export class PutIncompleteError extends Error {
  override readonly name = "PutIncompleteError";
  readonly unsent: Entry[];

  constructor(unsent: Entry[], lastErrorCode: string) {
    super(`${unsent.length} records were not accepted (${lastErrorCode})`);
    this.unsent = unsent;
  }
}

// #region put-in-order
/**
 * Sends the rounds one after another. Within a round, only the refused
 * entries are sent again. A round that cannot be completed stops everything
 * after it: going on would put later revisions in front of earlier ones.
 */
export async function putInOrder(
  writer: StreamWriter,
  entries: Entry[],
  options: { maxAttempts: number; wait: (attempt: number) => Promise<void> },
): Promise<{ requests: number }> {
  let requests = 0;
  const rounds = planRounds(entries);
  for (const [index, round] of rounds.entries()) {
    let pending = round;
    let lastErrorCode = "";
    for (let attempt = 1; pending.length > 0; attempt += 1) {
      if (attempt > options.maxAttempts) {
        throw new PutIncompleteError(
          [...pending, ...rounds.slice(index + 1).flat()],
          lastErrorCode,
        );
      }
      if (attempt > 1) {
        await options.wait(attempt - 1);
      }
      requests += 1;
      const { records } = await writer.putRecords(pending);
      const refused: Entry[] = [];
      for (const [position, entry] of pending.entries()) {
        const outcome = records[position];
        if (outcome === undefined || "errorCode" in outcome) {
          refused.push(entry);
          lastErrorCode = outcome?.errorCode ?? "missing from the response";
        }
      }
      pending = refused;
    }
  }
  return { requests };
}
// #endregion put-in-order

// #region put-naively
/** What the documentation's own example does: one request, then the refused entries again. */
export async function putNaively(writer: StreamWriter, entries: Entry[]): Promise<void> {
  let pending = entries;
  for (let attempt = 1; pending.length > 0 && attempt <= 5; attempt += 1) {
    const { records } = await writer.putRecords(pending);
    pending = pending.filter((_, position) => {
      const outcome = records[position];
      return outcome === undefined || "errorCode" in outcome;
    });
  }
}
// #endregion put-naively
