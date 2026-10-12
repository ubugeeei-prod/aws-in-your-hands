import { type Batch, isInSync, type Plan, planSync, toBatches } from "./plan.ts";

// #region port
export type Snapshot = { etag: string; entries: ReadonlyMap<string, string> };

/** The store as the sync sees it. The AWS adapter and the test double both implement this. */
export type KvsPort = {
  /** The ETag must be read before the pairs, never after. */
  read(): Promise<Snapshot>;
  /** Applies one batch if the store is still at `etag`. Returns the new ETag. */
  update(etag: string, batch: Batch): Promise<string>;
};

/** The store moved on since `etag` was read. Nothing was written. */
export class KvsConflictError extends Error {
  override name = "KvsConflictError";
}

/** The write may or may not have happened: a timeout, a dropped connection, a 5xx. */
export class KvsUnavailableError extends Error {
  override name = "KvsUnavailableError";
}
// #endregion port

export type SyncResult = {
  outcome: "already-in-sync" | "applied";
  /** How many times the store was read. More than one means a conflict or an unclear write happened. */
  rounds: number;
  /** Every plan that was started, in order. A later one describes what an earlier one left to do. */
  plans: Plan[];
  etag: string;
};

// #region sync
/**
 * Makes the managed keys equal to `desired`. Every round starts from a fresh
 * read, so a retry never repeats an old plan: it plans again from what is there now.
 */
export async function syncStore(
  port: KvsPort,
  desired: ReadonlyMap<string, string>,
  options: { maxRounds?: number } = {},
): Promise<SyncResult> {
  const maxRounds = options.maxRounds ?? 5;
  const plans: Plan[] = [];
  let lastError: unknown;

  for (let round = 1; round <= maxRounds; round++) {
    const snapshot = await port.read();
    const plan = planSync(desired, snapshot.entries);
    if (isInSync(plan)) {
      return {
        outcome: plans.length === 0 ? "already-in-sync" : "applied",
        rounds: round,
        plans,
        etag: snapshot.etag,
      };
    }
    plans.push(plan);

    try {
      let etag = snapshot.etag;
      for (const batch of toBatches(plan)) {
        etag = await port.update(etag, batch);
      }
      return { outcome: "applied", rounds: round, plans, etag };
    } catch (error) {
      if (!(error instanceof KvsConflictError) && !(error instanceof KvsUnavailableError)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw new Error(
    `the store kept changing or failing for ${maxRounds} rounds; run the sync again`,
    {
      cause: lastError,
    },
  );
}
// #endregion sync
