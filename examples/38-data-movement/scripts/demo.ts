// vp run move:demo
// Three executions of the archive copy against two buckets in memory. No AWS.

import { objectKey } from "@aih/example-07-uploads/api/src/keys.ts";

import { runExecution } from "../src/execution.ts";
import { MemoryBucket } from "../src/memory-bucket.ts";
import { planExecution } from "../src/plan.ts";
import { ARCHIVE_TASK } from "../src/task.ts";

let tick = Date.parse("2026-10-13T00:00:00Z");
const now = () => new Date((tick += 1000));
const source = new MemoryBucket(now);
const archive = new MemoryBucket(now);
const key = (owner: string, attachmentId: string) =>
  objectKey({ owner, noteId: "n1", attachmentId });

const show = (title: string) => {
  const plan = planExecution(source.list(), archive.list(), ARCHIVE_TASK);
  console.log(`\n${title}`);
  console.log(
    `  plan: transfer ${plan.transfer.length} (${plan.bytes} bytes), skip ${plan.skip.length}, delete ${plan.delete.length}`,
  );
  for (const transfer of plan.transfer) {
    const warning = transfer.destinationNewer ? "  <- the archive's copy is newer" : "";
    console.log(`    ${transfer.reason.padEnd(8)}${transfer.key}${warning}`);
  }
};
const run = (stopAfterCopies?: number) => {
  const result = runExecution(
    source,
    archive,
    ARCHIVE_TASK,
    stopAfterCopies === undefined ? {} : { stopAfterCopies },
  );
  console.log(
    `  run:  ${result.status}, copied ${result.transferred.length}, archive now holds ${archive.list().length}`,
  );
};

for (const name of ["a1", "a2", "a3", "a4"]) {
  source.put(key("alice", name), `image ${name}`);
}
show("1. Four attachments, an empty archive. The execution stops after two copies.");
run(2);

show("2. The next execution picks up where the first one stopped.");
run();

source.put(key("alice", "a1"), "image a1, replaced");
source.delete(key("alice", "a4"));
archive.put(key("alice", "a2"), "edited in the archive");
show("3. One object replaced and one deleted in the source, one edited in the archive.");
run();

show("4. Nothing has changed since.");
run();
console.log(
  `\nThe archive still holds ${key("alice", "a4")}: the task keeps what the source deleted.`,
);
