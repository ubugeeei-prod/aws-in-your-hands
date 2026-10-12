// #region shard-order
export type ShardRef = {
  shardId: string;
  parentShardId?: string | undefined;
  /** The second parent of a shard made by a merge. */
  adjacentParentShardId?: string | undefined;
};

/**
 * Parents before their children. A reader that follows this order, and reads
 * each shard to its end before the next, sees a note's records as they were written.
 * A parent that is no longer listed has expired, and holds nothing to wait for.
 */
export function parentsFirst<T extends ShardRef>(shards: T[]): T[] {
  const listed = new Set(shards.map((shard) => shard.shardId));
  const placed = new Set<string>();
  const ordered: T[] = [];
  let waiting = shards;
  while (waiting.length > 0) {
    const ready = waiting.filter((shard) =>
      [shard.parentShardId, shard.adjacentParentShardId].every(
        (parent) => parent === undefined || !listed.has(parent) || placed.has(parent),
      ),
    );
    if (ready.length === 0) {
      throw new Error("the shards' parents form a cycle");
    }
    for (const shard of ready) {
      placed.add(shard.shardId);
      ordered.push(shard);
    }
    waiting = waiting.filter((shard) => !placed.has(shard.shardId));
  }
  return ordered;
}
// #endregion shard-order
