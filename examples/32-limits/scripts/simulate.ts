// vp run limits:simulate
//   node scripts/simulate.ts
//
// Prints what the two simulations in src/simulation.ts give. Local: no network, no AWS.

import { SDK_RETRY_BUDGET } from "../src/sdk-retry.ts";
import {
  type Outcome,
  outage,
  peakRetries,
  reconnect,
  sentBetween,
  simulate,
} from "../src/simulation.ts";

const row = (cells: (string | number)[]) =>
  console.log(
    cells
      .map((cell, index) => String(cell).padEnd(index === 0 ? 22 : 12))
      .join("")
      .trimEnd(),
  );

console.log("1,000 callers start at once; the service lets 200 a second through (burst 100)\n");
row(["", "sent", "succeeded", "gave up", "peak retries in 10 ms"]);
for (const jitter of ["none", "full"] as const) {
  const outcome = simulate(reconnect(jitter));
  row([`jitter: ${jitter}`, outcome.sent, outcome.succeeded, outcome.gaveUp, peakRetries(outcome)]);
}

const during = (outcome: Outcome) => sentBetween(outcome, 200, 500);
console.log("\n500 calls a second; the service refuses everything for 3 seconds\n");
row(["", "sent", "in outage", "held back", "gave up"]);
for (const [label, budget] of [
  ["no retry budget", undefined],
  ["retry budget", SDK_RETRY_BUDGET],
] as const) {
  const outcome = simulate(outage(budget));
  row([label, outcome.sent, during(outcome), outcome.heldBack, outcome.gaveUp]);
}
console.log("\nFirst attempts in those 3 seconds: 1500. Everything above that is retries.");
