// vp run sfn:local [--refuse <State>] [--lose <State>] [--times 99] [--infected] [--redrive]
//   node scripts/run-local.ts ...
//
// Walks the import's definition on this machine, against a table, a bucket, a
// queue and a topic kept in memory. --refuse makes a state's call fail; --lose
// lets it do its work and drops the answer. --redrive resumes a failed run from
// the state it stopped in, with the fault gone. No AWS, no credentials.

import { parseArgs } from "node:util";

import * as v from "valibot";

import type { Outcome } from "../src/interpreter.ts";
import { leftover, violations } from "../src/invariant.ts";
import { LocalWorld } from "../src/local-world.ts";
import { localImport, runImport } from "../src/local.ts";
import { type ImportInput, importInputSchema } from "../src/saga.ts";

const { values } = parseArgs({
  options: {
    refuse: { type: "string" },
    lose: { type: "string" },
    times: { type: "string", default: "99" },
    infected: { type: "boolean", default: false },
    redrive: { type: "boolean", default: false },
  },
});
const stateName = v.optional(v.picklist(Object.keys(localImport.States)));
const options = v.parse(
  v.object({
    refuse: stateName,
    lose: stateName,
    times: v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(99)),
    infected: v.boolean(),
    redrive: v.boolean(),
  }),
  values,
);

const input: ImportInput = v.parse(importInputSchema, {
  owner: "user-1",
  noteId: "note-1",
  title: "Minutes",
  body: "What was said",
  upload: "inbox/user-1/minutes.pdf",
});
const world = new LocalWorld();
world.objects.set(input.upload, "the uploaded bytes");
if (options.infected) {
  world.scanner = () => ({ verdict: "infected" });
}
if (options.refuse !== undefined) {
  world.fail({
    state: options.refuse,
    error: "Injected.Refused",
    times: options.times,
    kind: "refused",
  });
}
if (options.lose !== undefined) {
  world.fail({ state: options.lose, error: "States.Timeout", times: options.times, kind: "lost" });
}

function report(outcome: Outcome): void {
  for (const step of outcome.steps) {
    console.log(
      `  ${step.state}${step.attempt > 1 ? ` (attempt ${step.attempt})` : ""}${step.error === undefined ? "" : `  ! ${step.error}`}`,
    );
  }
  console.log(
    outcome.status === "SUCCEEDED"
      ? `SUCCEEDED ${JSON.stringify(outcome.output)}`
      : `FAILED ${outcome.error}: ${outcome.cause}`,
  );
  const left = leftover(world, input);
  console.log(`left behind: ${left.note} note, ${left.attachment ? "an" : "no"} attachment`);
  console.log(
    `notices sent: ${world.notices.length}, retries waited up to ${outcome.waitedSeconds} s`,
  );
  const broken = violations(world, input, outcome);
  console.log(broken.length === 0 ? "invariant: holds" : `invariant: BROKEN: ${broken.join("; ")}`);
}

const first = await runImport(world, input);
report(first);
if (options.redrive && first.status === "FAILED" && first.resume !== undefined) {
  console.log(`\nredrive from ${first.resume.state}, with the fault gone:`);
  world.heal();
  report(await runImport(world, input, first.resume));
}
