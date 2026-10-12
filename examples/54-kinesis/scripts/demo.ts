// vp run kinesis:demo
//   node scripts/demo.ts
//
// The failures of the chapter, one after another, against the in-memory
// stream and the model of the event source mapping. No AWS, no network.

import type { NoteHistory } from "../src/history.ts";
import { type Handler, LAMBDA_DEFAULTS } from "../src/local-poller.ts";
import { createLocal } from "../src/local.ts";
import { putInOrder, putNaively } from "../src/producer.ts";
import { entryOf, poison, revisionsOf } from "../test/fixtures.ts";

const show = (label: string, history: NoteHistory | undefined, extra = "") =>
  console.log(
    `${label.padEnd(52)} ${
      history === undefined
        ? "nothing applied"
        : `version ${history.version}, from ${history.revisions} revisions`
    }${extra}`,
  );

/** Does its work, and the first time Lambda never hears the answer. */
function answerLostOnce(handler: Handler): Handler {
  let lost = false;
  return async (event) => {
    const response = await handler(event);
    if (!lost) {
      lost = true;
      throw new Error("timed out");
    }
    return response;
  };
}
const throwing =
  (handler: Handler): Handler =>
  async (event) => {
    const response = await handler(event);
    if ((response?.batchItemFailures.length ?? 0) > 0) {
      throw new Error("batch failed");
    }
    return response;
  };

console.log("1. Five revisions of a note, and a function that fails after doing its work");
{
  const local = createLocal();
  local.stream.putRecords(revisionsOf("n1", 5).map(entryOf));
  const guarded = local.consumer({ wrap: answerLostOnce });
  const blind = local.consumer({ mode: "blind", wrap: answerLostOnce });
  await guarded.poller.drain();
  await blind.poller.drain();
  show("   compares versions before it writes", await guarded.store.get("n1"));
  show("   applies whatever arrives", await blind.store.get("n1"));
}

console.log("\n2. a@1 a@2 <poison> b@1 b@2 in one shard");
{
  const fill = () => {
    const local = createLocal();
    local.stream.putRecords([
      ...revisionsOf("a", 2).map(entryOf),
      poison(),
      ...revisionsOf("b", 2).map(entryOf),
    ]);
    return local;
  };
  const defaults = fill().consumer({ settings: LAMBDA_DEFAULTS, wrap: throwing });
  const reached = await defaults.poller.drain(500);
  show(
    "   Lambda's defaults, after 500 tries",
    await defaults.store.get("b"),
    reached ? "" : " for b: the shard is stuck",
  );
  const stack = fill().consumer();
  await stack.poller.drain();
  show(
    "   the stack's settings",
    await stack.store.get("b"),
    ` for b; given up on: ${stack.poller.discarded.length} batch of ${stack.poller.discarded[0]?.KinesisBatchInfo.batchSize} record`,
  );
}

console.log("\n3. Two revisions in one PutRecords request, and the first is refused once");
{
  const naive = createLocal();
  naive.stream.rejectNext((_, index) => index === 0);
  await putNaively(naive.writer, revisionsOf("n1", 2).map(entryOf));
  const naiveConsumer = naive.consumer();
  await naiveConsumer.poller.drain();
  show("   refused entries sent again", await naiveConsumer.store.get("n1"));

  const ordered = createLocal();
  ordered.stream.rejectNext((_, index) => index === 0);
  await putInOrder(ordered.writer, revisionsOf("n1", 2).map(entryOf), {
    maxAttempts: 3,
    wait: async () => {},
  });
  const orderedConsumer = ordered.consumer();
  await orderedConsumer.poller.drain();
  show("   one revision of a note per request", await orderedConsumer.store.get("n1"));
}

console.log("\n4. A second consumer, added an hour later, reads from the oldest record");
{
  const local = createLocal();
  local.stream.putRecords(revisionsOf("n1", 3).map(entryOf));
  const first = local.consumer();
  await first.poller.drain();
  local.advance(60 * 60 * 1000);
  const second = local.consumer();
  await second.poller.drain();
  show("   the first consumer", await first.store.get("n1"));
  show("   the second consumer", await second.store.get("n1"));
}
