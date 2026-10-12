// vp run events:demo
//   node scripts/demo.ts
//
// One morning of changes through the in-memory bus, then a duplicate, then a
// replay. Prints the two counters side by side. No AWS, no network.

import { createLocal } from "../src/local.ts";
import {
  inspectionWritten,
  noteInserted,
  noteModified,
  noteRemoved,
  OWNER,
} from "../test/fixtures.ts";

const local = createLocal();
const show = async (label: string) => {
  console.log(
    `${label.padEnd(44)} counter=${await local.counted.get(OWNER)}  naive=${await local.naive.get(OWNER)}  ` +
      `n1=${(await local.timeline.get(OWNER, "n1"))?.lastEvent ?? "-"}  dead letters=${local.bus.deadLetters.length}`,
  );
};

local.publish(noteInserted("n1"));
local.advance(10);
local.publish(noteInserted("n2"));
local.advance(10);
local.publish(noteModified("n1", 1, 2));
local.publish(inspectionWritten("rejected"));
await local.bus.drain();
await show("two notes created, one updated, each once");

local.publish(noteInserted("n2"));
await local.bus.drain();
await show("the creation of n2 published a second time");

local.advance(10);
local.publish(noteRemoved("n2"));
const late = local.bus.take();
for (const delivery of [...late.toReversed(), ...late]) {
  await local.bus.deliver(delivery);
}
await show("n2 deleted, delivered twice, in reverse");

const replayed = local.bus.replay({
  name: "demo",
  from: new Date(Date.UTC(2026, 9, 12)),
  to: new Date(Date.UTC(2026, 9, 13)),
});
await local.bus.drain();
await show(`replay of ${replayed} archived events`);

// The rule for notices lets no replayed event through, so there is still one.
console.log(`rejection notices sent: ${local.notices.length}, for one rejected attachment`);
console.log("One note exists (n1). The counter that remembers event IDs says 1.");
