// vp run kinesis:put                               five revisions of note "demo" (writes to AWS)
// vp run kinesis:put -- --note n2 --from 6 --count 3
// vp run kinesis:put -- --poison                   one record that is no revision, to watch it being given up on
//   node scripts/put.ts [--note <id>] [--from <version>] [--count <n>] [--poison]
//
// Writes revisions to the deployed stream with your credentials, one revision
// of a note per PutRecords request. Running it twice writes the same versions
// twice: the consumer applies them once.

import { parseArgs } from "node:util";

import { KinesisClient } from "@aws-sdk/client-kinesis";
import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { KinesisWriter } from "../src/kinesis-writer.ts";
import { putInOrder } from "../src/producer.ts";
import { encode, partitionKeyOf, type Revision } from "../src/revision.ts";

const STACK = "AihKinesis";
const count = v.pipe(v.string(), v.regex(/^\d+$/), v.transform(Number), v.minValue(1));
const args = v.parse(
  v.object({
    note: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(64)), "demo"),
    from: v.optional(count, "1"),
    count: v.optional(v.pipe(count, v.maxValue(1000)), "5"),
    poison: v.optional(v.boolean(), false),
  }),
  parseArgs({
    options: {
      note: { type: "string" },
      from: { type: "string" },
      count: { type: "string" },
      poison: { type: "boolean" },
    },
  }).values,
);

try {
  const { target } = await preflight({
    access: "mutate",
    action: args.poison
      ? "put one poison record into the stream"
      : `put ${args.count} records into the stream`,
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const writer = new KinesisWriter(
    new KinesisClient({ region: target.region }),
    requireOutput(outputs, "StreamArn"),
  );
  if (args.poison) {
    // Bytes the function can never read as a revision. Lambda retries it, then gives up on it.
    await writer.putRecords([
      { partitionKey: "poison", data: new TextEncoder().encode("{not json") },
    ]);
    console.log("put one record that is not JSON, under the partition key poison");
    process.exit(0);
  }
  const revisions = Array.from({ length: args.count }, (_, index): Revision => {
    const version = args.from + index;
    return {
      noteId: args.note,
      owner: "kinesis-put",
      version,
      kind: version === 1 ? "created" : "edited",
      at: new Date().toISOString(),
    };
  });
  const { requests } = await putInOrder(
    writer,
    revisions.map((revision) => ({
      partitionKey: partitionKeyOf(revision),
      data: encode(revision),
    })),
    {
      maxAttempts: 5,
      // 200 ms, 400 ms, 800 ms, ... A shard's limit is counted per second.
      wait: (attempt) => new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt)),
    },
  );
  console.log(
    `put versions ${args.from} to ${args.from + args.count - 1} of note ${args.note} in ${requests} requests`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
