// vp run limits:load
//   node scripts/load.ts [--url http://localhost:8787] [--rates 5,10,20,40] [--seconds 5] [--path /health]
//
// Sends requests to the development server at each rate in turn and prints what came back.
// Local only: src/load.ts refuses any address that is not this machine.

import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import * as v from "valibot";

import {
  firstLimit,
  localTarget,
  type Sample,
  schedule,
  type Step,
  summarize,
} from "../src/load.ts";

// A flag's value is text. "5" becomes 5; "fast" becomes NaN, which v.number() refuses.
const positive = v.pipe(v.string(), v.transform(Number), v.number(), v.gtValue(0));

const argsSchema = v.object({
  url: v.optional(v.string(), "http://localhost:8787"),
  path: v.optional(v.pipe(v.string(), v.startsWith("/")), "/health"),
  rates: v.optional(
    v.pipe(
      v.string(),
      v.transform((text) => text.split(",")),
      v.array(v.pipe(positive, v.maxValue(500))),
      v.minLength(1),
    ),
    "5,10,20,40",
  ),
  seconds: v.optional(v.pipe(positive, v.maxValue(60)), "5"),
});

// #region step
async function runStep(target: URL, requestsPerSecond: number, seconds: number): Promise<Step> {
  const startedAt = performance.now();
  const samples = await Promise.all(
    schedule(requestsPerSecond, seconds).map(async (offset): Promise<Sample> => {
      // Each request leaves at its planned time, whether or not earlier ones were answered.
      await sleep(Math.max(0, startedAt + offset - performance.now()));
      const sentAt = performance.now();
      try {
        const response = await fetch(target, { signal: AbortSignal.timeout(10_000) });
        await response.arrayBuffer();
        return {
          status: response.status,
          latencyMs: performance.now() - sentAt,
          retryAfter: response.headers.has("retry-after"),
        };
      } catch {
        // No answer at all: refused connection, or nothing within 10 seconds.
        return { status: 0, latencyMs: performance.now() - sentAt };
      }
    }),
  );
  return { requestsPerSecond, summary: summarize(samples) };
}
// #endregion step

try {
  const args = v.parse(
    argsSchema,
    parseArgs({
      options: {
        url: { type: "string" },
        path: { type: "string" },
        rates: { type: "string" },
        seconds: { type: "string" },
      },
    }).values,
  );
  const target = new URL(args.path, localTarget(args.url));
  const ms = (value: number | undefined) => (value === undefined ? "-" : value.toFixed(1));

  console.log(`target ${target.href}, ${args.seconds} s at each rate\n`);
  console.log("req/s   sent   p50 ms   p95 ms   max ms   answers");
  const steps: Step[] = [];
  for (const rate of args.rates) {
    const step = await runStep(target, rate, args.seconds);
    steps.push(step);
    const { summary } = step;
    const answers = Object.entries(summary.byAnswer)
      .map(([answer, count]) => `${answer === "0" ? "none" : answer}: ${count}`)
      .join(", ");
    console.log(
      [
        String(rate).padEnd(7),
        String(summary.requests).padEnd(6),
        ms(summary.p50Ms).padEnd(8),
        ms(summary.p95Ms).padEnd(8),
        ms(summary.maxMs).padEnd(8),
        answers,
      ].join(" "),
    );
    // Let the server's bucket fill up again, so each rate starts from the same state.
    await sleep(3000);
  }

  const limit = firstLimit(steps);
  console.log(
    limit === undefined
      ? "\nNo rate was refused. The first limit is above the highest rate tried."
      : `\nThe first limit shows at ${limit.requestsPerSecond} requests a second.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
