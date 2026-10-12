// vp run kinesis:replay                                  every record the stream still holds (reads AWS)
// vp run kinesis:replay -- --since 2026-10-13T09:00:00Z  from a point in time
//   node scripts/replay.ts [--since <ISO timestamp>]
//
// A second consumer, on your machine: reads the deployed stream from its
// oldest record with GetRecords, parents before children, and builds the
// notes' histories in memory with the code the function runs. It writes
// nothing, and the function's own position in the stream does not move.

import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import {
  GetRecordsCommand,
  GetShardIteratorCommand,
  KinesisClient,
  ListShardsCommand,
} from "@aws-sdk/client-kinesis";
import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { InMemoryHistoryStore, missingOf } from "../src/history.ts";
import { decode, PoisonRecordError } from "../src/revision.ts";
import { parentsFirst } from "../src/shard-order.ts";

const STACK = "AihKinesis";
const { since } = v.parse(
  v.object({
    since: v.optional(
      v.pipe(
        v.string(),
        v.isoTimestamp(),
        v.transform((text) => new Date(text)),
      ),
    ),
  }),
  parseArgs({ options: { since: { type: "string" } } }).values,
);

try {
  const { target } = await preflight({
    access: "observe",
    action: "read the stream from its oldest record",
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const StreamARN = requireOutput(outputs, "StreamArn");
  const kinesis = new KinesisClient({ region: target.region });

  // One page: this stream has far fewer shards than a page holds.
  const listed = await kinesis.send(new ListShardsCommand({ StreamARN }));
  const shards = parentsFirst(
    (listed.Shards ?? []).map((shard) => ({
      shardId: shard.ShardId ?? "",
      parentShardId: shard.ParentShardId,
      adjacentParentShardId: shard.AdjacentParentShardId,
    })),
  );

  const store = new InMemoryHistoryStore();
  let read = 0;
  let stale = 0;
  let poison = 0;
  for (const { shardId } of shards) {
    let { ShardIterator: iterator } = await kinesis.send(
      new GetShardIteratorCommand({
        StreamARN,
        ShardId: shardId,
        ...(since === undefined
          ? { ShardIteratorType: "TRIM_HORIZON" }
          : { ShardIteratorType: "AT_TIMESTAMP", Timestamp: since }),
      }),
    );
    // A closed shard ends with no iterator. An open one ends, for this run, when it has caught up.
    while (iterator !== undefined) {
      const page = await kinesis.send(
        new GetRecordsCommand({ StreamARN, ShardIterator: iterator }),
      );
      for (const record of page.Records ?? []) {
        read += 1;
        try {
          const revision = decode(record.PartitionKey ?? "", record.Data ?? new Uint8Array());
          stale += (await store.apply(revision)) === "stale" ? 1 : 0;
        } catch (error) {
          if (!(error instanceof PoisonRecordError)) {
            throw error;
          }
          poison += 1;
          console.log(`poison record ${shardId}:${record.SequenceNumber}: ${error.message}`);
        }
      }
      if ((page.Records ?? []).length === 0 && page.MillisBehindLatest === 0) {
        break;
      }
      iterator = page.NextShardIterator;
      // A shard answers five GetRecords calls a second, shared with the function's mapping.
      await sleep(250);
    }
  }

  console.log(
    `${read} records in ${shards.length} shards: ${stale} already applied, ${poison} poison`,
  );
  for (const history of store.all().toSorted((a, b) => a.noteId.localeCompare(b.noteId))) {
    console.log(
      `${history.noteId.padEnd(24)} version ${history.version}  revisions ${history.revisions}  ` +
        `missing ${missingOf(history)}${history.deleted ? "  deleted" : ""}`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
