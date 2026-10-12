// vp run export:local [--notes 250] [--pages-per-call 1] [--lose 2] [--break 3]
//   node scripts/run-local.ts ...
//
// Runs the deployed workflow definition on this machine, against stores in
// memory. --lose N drops the answer of the Nth call of the page step, as a
// timeout would. --break N refuses to write part N until the retries run out,
// then resumes the run the way a redrive would. No AWS, no credentials.

import { parseArgs } from "node:util";

import * as v from "valibot";

import { MemoryExportStore } from "../src/export-store.ts";
import { manifestKey, manifestSchema, partKey } from "../src/job.ts";
import { type Invoke, type Outcome, runWorkflow, TaskError } from "../src/local-workflow.ts";
import { localDefinition, localInvoke } from "../src/local.ts";
import { MemoryNoteSource } from "../src/note-source.ts";
import { atMostPages } from "../src/steps.ts";

const { values } = parseArgs({
  options: {
    notes: { type: "string", default: "250" },
    "page-size": { type: "string", default: "100" },
    "pages-per-call": { type: "string", default: "1" },
    lose: { type: "string", default: "0" },
    break: { type: "string", default: "0" },
  },
});
const count = (min: number) =>
  v.pipe(
    v.string(),
    v.transform(Number),
    v.number(),
    v.integer(),
    v.minValue(min),
    v.maxValue(100_000),
  );
const options = v.parse(
  v.object({
    notes: count(0),
    "page-size": count(1),
    "pages-per-call": count(1),
    lose: count(0),
    break: count(0),
  }),
  values,
);

const source = new MemoryNoteSource();
for (let number = 1; number <= options.notes; number++) {
  source.put({
    owner: number % 2 === 0 ? "alice" : "bob",
    id: `n${String(number).padStart(6, "0")}`,
    title: `note ${number}`,
    body: "",
    version: 1,
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
  });
}
const store = new MemoryExportStore();
const exportId = "2026-10-12T030000Z";

let refusals = options.break > 0 ? 4 : 0;
const breaking: MemoryExportStore["putIfAbsent"] = async (key, body, metadata) => {
  if (key === partKey(exportId, options.break) && refusals-- > 0) {
    throw new Error(`injected: the bucket refused ${key}`);
  }
  return store.putIfAbsent(key, body, metadata);
};
const steps = localInvoke({ source, store: { ...bind(store), putIfAbsent: breaking } }, () => ({
  pageSize: options["page-size"],
  mayContinue: atMostPages(options["pages-per-call"]),
}));

function bind(target: MemoryExportStore) {
  return {
    head: target.head.bind(target),
    list: target.list.bind(target),
    delete: target.delete.bind(target),
  };
}

let pageCalls = 0;
const invoke: Invoke = async (resource, input) => {
  const output = await steps(resource, input);
  if (resource.endsWith("export-pages") && ++pageCalls === options.lose) {
    throw new TaskError("States.Timeout", "injected: the work was done, the answer was lost");
  }
  return output;
};

function report(label: string, outcome: Outcome): void {
  console.log(`${label}: ${outcome.status}`);
  for (const step of outcome.steps) {
    console.log(
      `  ${step.state} attempt ${step.attempt}${step.error === undefined ? "" : ` -> ${step.error}`}`,
    );
  }
  if (outcome.status === "FAILED") {
    console.log(`  error: ${outcome.error} (${outcome.cause})`);
  }
}

let outcome = await runWorkflow(localDefinition, { exportId: "2026-10-12T03:00:00Z" }, invoke);
report("run", outcome);
if (outcome.status === "FAILED" && outcome.resume !== undefined) {
  console.log(`resuming at ${outcome.resume.state} with ${JSON.stringify(outcome.resume.input)}`);
  outcome = await runWorkflow(localDefinition, outcome.resume.input, invoke, outcome.resume);
  report("resumed", outcome);
}

const manifest = store.read(manifestKey(exportId));
if (manifest === undefined) {
  console.log("no manifest: the export is not readable");
  process.exit(1);
}
const { parts } = v.parse(manifestSchema, JSON.parse(manifest));
const lines = parts
  .flatMap((key) => (store.read(key) ?? "").trimEnd().split("\n"))
  .filter((line) => line !== "");
const distinct = new Set(
  lines.map(
    (line) => v.parse(v.object({ owner: v.string(), id: v.string() }), JSON.parse(line)).id,
  ),
);
console.log(
  `manifest: ${parts.length} parts, ${lines.length} lines, ${distinct.size} distinct notes of ${options.notes}`,
);
process.exit(lines.length === options.notes && distinct.size === options.notes ? 0 : 1);
