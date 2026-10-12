// vp run bedrock:batch:plan
//   node scripts/batch-plan.ts [--records 100]
//
// Shapes notes into the input file of a batch inference job and checks it against the
// job's limits. Local only: nothing is uploaded and no job is created.

import { parseArgs } from "node:util";

import { planBatch, summaryRecord, toJsonl } from "../src/batch.ts";
import { seededNotes } from "../src/local-notes.ts";
import { profileOf } from "../src/models.ts";

const { values } = parseArgs({ options: { records: { type: "string", default: "100" } } });
const wanted = Number(values.records);

const { notes } = await (await seededNotes()).list("local-alice", { limit: 20 });
// The fixture has three notes. They are repeated under new IDs to reach the job's minimum.
const records = Array.from({ length: wanted }, (_, n) => {
  const note = notes[n % notes.length];
  if (note === undefined) {
    throw new Error("no notes to summarize");
  }
  return summaryRecord({ ...note, id: `${note.id}x${String(n).padStart(5, "0")}` }, 400);
});

const plan = planBatch(records);
console.log(toJsonl(records.slice(0, 1)).trimEnd());
if (!plan.ok) {
  console.error(`not a job Bedrock would take: ${plan.problems.join("; ")}`);
  process.exit(1);
}
const prices = profileOf("jp.amazon.nova-2-lite-v1:0").usdPerMillionTokens;
console.log(`${plan.records} records, ${plan.bytes} bytes: within the limits read on 2026-10-13`);
console.log(
  `on-demand list price per million tokens in/out: ${prices.input}/${prices.output}; batch is half of each`,
);
