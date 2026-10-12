// vp run fargate:simulate
//   node scripts/simulate.ts [--start-minutes 2] [--capacity 900]
//
// Runs this chapter's model of target tracking over the hand-written morning
// curve and prints one line per change. Nothing here is Application Auto Scaling.

import { parseArgs } from "node:util";

import { timing } from "@aih/example-12-containers/src/timing.ts";

import { inFlightAt, stopOutcome } from "../src/drain.ts";
import { MODEL, POLICY } from "../src/model-defaults.ts";
import { morningCurve, simulate, summarize } from "../src/scaling.ts";

const { values } = parseArgs({
  options: {
    "start-minutes": { type: "string", default: String(MODEL.startMinutes) },
    capacity: { type: "string", default: String(MODEL.capacityPerTask) },
  },
});
const model = {
  ...MODEL,
  startMinutes: Number(values["start-minutes"]),
  capacityPerTask: Number(values.capacity),
};
if (!Number.isInteger(model.startMinutes) || !(model.capacityPerTask > 0)) {
  console.error("--start-minutes takes a whole number, --capacity a positive one");
  process.exit(64);
}

const timeline = simulate(morningCurve(), POLICY, model);
console.log("minute  load  serving  desired  per-task  over-capacity  action");
let previous = "";
for (const entry of timeline) {
  const state = `${entry.load}/${entry.serving}/${entry.desired}/${entry.action}`;
  if (state !== previous) {
    console.log(
      [
        String(entry.minute).padStart(6),
        String(entry.load).padStart(5),
        String(entry.serving).padStart(8),
        String(entry.desired).padStart(8),
        String(entry.perTask).padStart(9),
        String(entry.overCapacity).padStart(14),
        `  ${entry.action ?? ""}`,
      ].join(" "),
    );
  }
  previous = state;
}

const summary = summarize(timeline, model);
console.log(`\npeak: ${summary.peakTasks} tasks, ${summary.taskMinutes} task-minutes in all`);
console.log(`requests that arrived while every serving task was full: ${summary.overCapacity}`);

// What the tasks removed by the first scale-in were holding, with and without a drain.
const [firstIn] = summary.scaleIns;
if (firstIn !== undefined) {
  const before = timeline[firstIn.minute];
  const holding = inFlightAt(before?.perTask ?? 0, [0.2, 0.2, 0.5, 1, 8]);
  const stop = { shutdownDeadline: timing.shutdownDeadline, stopTimeout: timing.stopTimeout };
  const drained = stopOutcome(
    holding,
    { ...stop, deregistrationDelay: timing.deregistrationDelay },
    "deregister-first",
  );
  const undrained = stopOutcome(holding, { ...stop, deregistrationDelay: 0 }, "deregister-first");
  console.log(
    `scale-in at minute ${firstIn.minute} removes ${firstIn.removed} task(s), each holding ${holding.length} request(s):`,
  );
  console.log(
    `  deregistration delay ${timing.deregistrationDelay} s: ${drained.cut} cut per task`,
  );
  console.log(`  deregistration delay 0 s: ${undrained.cut} cut per task`);
}
