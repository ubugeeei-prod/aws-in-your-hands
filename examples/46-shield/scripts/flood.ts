// vp run shield:flood
//   node scripts/flood.ts [--items]
//
// Runs the floods of src/flood.ts against each set of defences and prices what is left
// with data/pricing. Local: no network, no AWS. --items prints the usage lines as JSON.

import { loadPricing } from "@aih/tools/data/load.ts";
import { calculate } from "@aih/tools/pricing/calc.ts";

import { billItems } from "../src/bill.ts";
import { ATTACK, type Outcome, served, total } from "../src/flood.ts";
import { MONTH_OPEN, RUNS } from "../src/runs.ts";

const { prices, allowances } = loadPricing();

const price = (id: string, outcome: Outcome, webAcl: boolean) =>
  calculate(
    {
      id,
      chapter: "46",
      title: { ja: "", en: "" },
      assumptions: { ja: [], en: [] },
      items: billItems(total(outcome), webAcl),
    },
    prices.prices,
    allowances,
  );

if (process.argv.includes("--items")) {
  console.log(
    JSON.stringify(
      {
        ...Object.fromEntries(
          RUNS.map((run) => [run.id, billItems(total(run.outcome()), run.webAcl)]),
        ),
        "shield-flood-month-open": billItems(MONTH_OPEN, false),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const row = (cells: (string | number)[]) =>
  console.log(
    cells
      .map((cell, index) => String(cell).padEnd(index === 0 ? 34 : index === 1 ? 30 : 13))
      .join("")
      .trimEnd(),
  );

console.log(
  "One hour. 100 requests a second from users; 5,000 a second of attack for 50 minutes.\n",
);
row(["attack", "defences", "blocked", "cached", "throttled", "ran function", "users*", "USD"]);
for (const run of RUNS) {
  const outcome = run.outcome();
  const all = total(outcome);
  row([
    run.attack,
    run.defences,
    all.blocked,
    all.cached,
    all.throttled,
    all.origin,
    `${(served(outcome, ATTACK.from, ATTACK.to) * 100).toFixed(1)}%`,
    price(run.id, outcome, run.webAcl).listUsd.toFixed(2),
  ]);
}
const month = calculate(
  {
    id: "shield-flood-month-open",
    chapter: "46",
    title: { ja: "", en: "" },
    assumptions: { ja: [], en: [] },
    items: billItems(MONTH_OPEN, false),
  },
  prices.prices,
  allowances,
);
console.log(
  `\nThe same 5,000 a second for 30 days with nothing in front: USD ${month.listUsd.toFixed(2)}`,
);
for (const line of month.lines) {
  console.log(`  ${line.priceId.padEnd(30)}${line.listUsd.toFixed(2)}`);
}
console.log("\n* The share of the users' requests answered while the attack runs.");
console.log(
  "USD is the list price of that hour's usage: CloudFront, AWS WAF where attached, Lambda.",
);
console.log("A model with stated assumptions (src/flood.ts, src/bill.ts), not a measurement.");
