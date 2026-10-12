// vp run tune:report:sample           (local: the lines in fixtures/report-lines.txt)
// vp run tune:report [--minutes 60]   (AWS: the deployed function's log group)
//   node scripts/report.ts [--file <path>] [--minutes 60] [--max 10000]
//
// Reads the report Lambda writes for each invocation and prints how many started cold, how
// long initialization and the handler took, how much memory was used, and what was billed.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { type Line, parseLines, type Spread, summarize } from "../src/report.ts";

const STACK = "AihLambdaTuning";

// A flag's value is text. "60" becomes 60; "an hour" becomes NaN, which v.number() refuses.
const count = (max: number) =>
  v.pipe(v.string(), v.transform(Number), v.number(), v.integer(), v.minValue(1), v.maxValue(max));
const argsSchema = v.object({
  file: v.optional(v.string()),
  minutes: v.optional(count(10_080), "60"),
  max: v.optional(count(1_000_000), "10000"),
});

const eventsSchema = v.object({
  events: v.optional(v.array(v.object({ message: v.string() })), []),
});

const spreadLine = (spread: Spread | undefined) =>
  spread === undefined
    ? "no data"
    : `p50 ${spread.p50.toFixed(1)} ms, p95 ${spread.p95.toFixed(1)} ms, max ${spread.max.toFixed(1)} ms (${spread.count})`;

function print(lines: Line[]): void {
  const summary = summarize(lines);
  if (summary.invocations === 0) {
    console.log("No reports found. Has the function been invoked in this time range?");
    return;
  }
  const share = ((100 * summary.coldStarts) / summary.invocations).toFixed(1);
  console.log(`invocations       ${summary.invocations}`);
  console.log(`cold starts       ${summary.coldStarts} (${share}%)`);
  console.log(`initialization    ${spreadLine(summary.initDurationMs)}`);
  console.log(`handler, cold     ${spreadLine(summary.coldDurationMs)}`);
  console.log(`handler, warm     ${spreadLine(summary.warmDurationMs)}`);
  console.log(
    `memory            ${summary.maxMemoryUsedMb} MB used at most, of ${summary.memorySizeMb} MB`,
  );
  console.log(
    `billed            ${summary.billedMs} ms, ${summary.billedGbSeconds.toFixed(3)} GB-seconds`,
  );
  console.log(`not successful    ${summary.failures}`);
}

try {
  const { values } = parseArgs({
    options: { file: { type: "string" }, minutes: { type: "string" }, max: { type: "string" } },
  });
  const args = v.parse(argsSchema, values);

  if (args.file !== undefined) {
    print(parseLines(readFileSync(args.file, "utf8").split("\n")));
    process.exit(0);
  }

  const { target } = await preflight({
    access: "observe",
    action: "read the function's invocation reports",
    stack: STACK,
  });
  const logGroup = requireOutput(
    await readStackOutputs(process.cwd(), STACK, target.region),
    "HandlerLogGroupName",
  );
  const result = spawnSync(
    "aws",
    [
      "logs",
      "filter-log-events",
      "--region",
      target.region,
      "--log-group-name",
      logGroup,
      "--start-time",
      String(Date.now() - args.minutes * 60_000),
      // The CLI follows nextToken by itself, up to this many events.
      "--max-items",
      String(args.max),
      "--output",
      "json",
    ],
    { encoding: "utf8", maxBuffer: 1024 ** 3 },
  );
  if (result.status !== 0) {
    throw new Error(`aws logs filter-log-events failed:\n${result.stderr}`);
  }
  const { events } = v.parse(eventsSchema, JSON.parse(result.stdout));
  console.log(`last ${args.minutes} min of ${logGroup}: ${events.length} log events\n`);
  print(parseLines(events.map((event) => event.message)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
