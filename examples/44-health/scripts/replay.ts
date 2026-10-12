// Sends the fixtures through the same code the function runs, with the ledger in memory.
// Prints what would have been published. Touches nothing outside this process.

import { readFileSync } from "node:fs";

import { memoryLedger } from "../src/ledger.ts";
import { handle } from "../src/notify.ts";
import { matches } from "../src/pattern.ts";
import { DELIVERIES, patternsFor, SERVICES } from "../src/watch.ts";

type Fixtures = { events: { name: string; event: unknown }[] };
const load = (file: string) =>
  (JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url), "utf8")) as Fixtures)
    .events;

const fixtures = new Map(
  [...load("documented.json"), ...load("written.json")].map(({ name, event }) => [name, event]),
);

// #region order
// The order of arrival. One event comes twice, and one update comes after the closure it preceded.
const ARRIVALS = [
  "tokyo-ec2-retirement",
  "tokyo-lambda-runtime-lifecycle",
  "tokyo-lambda-runtime-lifecycle-page-2",
  "tokyo-s3-open-access-notification",
  "tokyo-lambda-issue-open",
  "tokyo-lambda-issue-open",
  "tokyo-multiple-services-issue",
  "tokyo-unlisted-service-issue",
  "tokyo-lambda-issue-closed",
  "tokyo-lambda-issue-update",
  "abuse-event-undocumented-detail",
  "docs-account-ec2-backup-copy",
];
// #endregion order

const ledger = memoryLedger();
let clock = Date.parse("2026-10-13T18:05:00Z");
let sent = 0;

for (const name of ARRIVALS) {
  const event = fixtures.get(name);
  const region = (event as { region: string }).region;
  const delivery = DELIVERIES.find((candidate) => candidate.region === region);
  const rule =
    delivery === undefined
      ? undefined
      : patternsFor(delivery).find(({ pattern }) => matches(pattern, event));

  console.log(`\n== ${name} (delivered to ${region})`);
  if (delivery === undefined || rule === undefined) {
    console.log(
      delivery === undefined
        ? "   no stack in that Region: never seen"
        : `   no rule of ${delivery.stack} matches: the function is not invoked`,
    );
    continue;
  }
  console.log(`   rule: ${delivery.stack} / ${rule.name}`);

  clock += 60_000;
  const outcome = await handle(event, {
    ledger,
    services: SERVICES,
    now: () => clock,
    log: () => {},
    publish: async () => {
      sent += 1;
    },
  });
  if (outcome.action !== "sent") {
    console.log(`   ${outcome.action}: ${outcome.why}`);
    continue;
  }
  console.log(`   sent (${outcome.change})`);
  console.log(`   Subject: ${outcome.message.subject}`);
  for (const line of outcome.message.body.split("\n")) {
    console.log(`   | ${line}`);
  }
}

console.log(`\n${ARRIVALS.length} arrivals, ${sent} messages.`);
