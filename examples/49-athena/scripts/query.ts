// vp run athena:sql --name route --from 2026-10-12 --to 2026-10-12 --route /notes   (prints; runs nothing)
// vp run athena:run --name route --from 2026-10-12 --to 2026-10-12 --route /notes   (AWS: BILLED per byte scanned)
//   node scripts/query.ts --name <statement> [--from <day>] [--to <day>] [--route <route>]
//                         [--export <name>] [--reuse <minutes>] [--attempt <text>] [--run]

import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import { AthenaClient } from "@aws-sdk/client-athena";
import * as v from "valibot";

import { athenaBilledBytes } from "@aih/example-26-analytics/src/cost-inputs.ts";
import { DATABASE } from "@aih/example-26-analytics/src/names.ts";
import { dayOf, daySchema } from "@aih/example-26-analytics/src/partition.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { athenaApi } from "../src/athena-sdk.ts";
import { runQuery } from "../src/client.ts";
import {
  compactDays,
  createCompactTable,
  createIcebergTable,
  eventsPerDayYesterday,
  mergeDays,
  optimizeDays,
  requestsForRoute,
  routeSchema,
  scratchErrors,
  unloadDays,
  vacuum,
} from "../src/queries.ts";
import { type Statement, trusted } from "../src/statement.ts";

const STACK = "AihAthena";
// The bucket name AWS's documentation uses for examples. Printed SQL only; a run reads the stack's outputs.
const EXAMPLE_BUCKET = "amzn-s3-demo-bucket";
const today = dayOf(new Date());

const NAMES = [
  "route",
  "create-compact",
  "compact",
  "scratch",
  "unload",
  "create-iceberg",
  "merge",
  "optimize",
  "vacuum",
  "yesterday",
] as const;

const argsSchema = v.object({
  name: v.picklist(NAMES),
  from: v.optional(daySchema, today),
  to: v.optional(daySchema, today),
  // The route is checked against the list even though it travels as a parameter.
  route: v.optional(routeSchema, "/notes"),
  export: v.optional(v.string(), "export-1"),
  reuse: v.optional(v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(0))),
  // A new value runs the query again. The same value asks for the run that was already started.
  attempt: v.optional(v.string(), () => new Date().toISOString()),
  run: v.optional(v.boolean(), false),
});
type Args = v.InferOutput<typeof argsSchema>;

function pick(args: Args, locations: { tables: string; exports: string }): Statement {
  const range = { from: args.from, to: args.to };
  switch (args.name) {
    case "route":
      return requestsForRoute({ ...range, route: args.route });
    case "create-compact":
      return createCompactTable(trusted(`${locations.tables}requests_compact/`));
    case "compact":
      return compactDays(range);
    case "scratch":
      return scratchErrors(range);
    case "unload":
      return unloadDays(range, trusted(locations.exports), args.export);
    case "create-iceberg":
      return createIcebergTable(trusted(`${locations.tables}requests_iceberg/`));
    case "merge":
      return mergeDays(range);
    case "optimize":
      return optimizeDays(range);
    case "vacuum":
      return vacuum();
    case "yesterday":
      return eventsPerDayYesterday();
  }
}

try {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      route: { type: "string" },
      export: { type: "string" },
      reuse: { type: "string" },
      attempt: { type: "string" },
      run: { type: "boolean" },
    },
  });
  const args = v.parse(argsSchema, values);

  if (!args.run) {
    const statement = pick(args, {
      tables: `s3://${EXAMPLE_BUCKET}/tables/`,
      exports: `s3://${EXAMPLE_BUCKET}/exports/`,
    });
    console.log(statement.sql);
    console.log(`\nparameters: ${JSON.stringify(statement.parameters)}`);
    process.exit(0);
  }

  const { target } = await preflight({
    access: "mutate",
    action: `run the Athena statement "${args.name}" (billed by bytes scanned; writes to S3)`,
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const statement = pick(args, {
    tables: requireOutput(outputs, "TablesLocation"),
    exports: requireOutput(outputs, "ExportsLocation"),
  });
  console.log(statement.sql);
  console.log(`\nparameters: ${JSON.stringify(statement.parameters)}\n`);

  const outcome = await runQuery(
    athenaApi(new AthenaClient({ region: target.region })),
    statement,
    {
      workGroup: requireOutput(outputs, "WorkGroupName"),
      database: DATABASE,
      attempt: args.attempt,
      ...(args.reuse !== undefined && { reuseMinutes: args.reuse }),
      maxWaitMs: 120_000,
      maxRows: 200,
      now: Date.now,
      sleep: (ms) => sleep(ms),
    },
  );

  console.log(`query: ${outcome.id}\nstate: ${outcome.state}`);
  if (outcome.state === "TIMED_OUT") {
    console.log(
      outcome.stopped
        ? "Stopped after two minutes. What it had scanned by then is billed."
        : "Could not stop it. Stop it in the console: it is still running.",
    );
    process.exit(1);
  }
  if (outcome.state === "SUCCEEDED") {
    console.table(outcome.rows);
    if (outcome.truncated) {
      console.log("Only the first 200 rows are shown. The whole result is in the result location.");
    }
    if (outcome.reused) {
      console.log("A stored result was reused: nothing was scanned.");
    }
  } else {
    console.log(`reason: ${outcome.reason}`);
  }
  console.log(
    outcome.scannedBytes === undefined
      ? "scanned: not reported"
      : `scanned ${outcome.scannedBytes} bytes; billed as ${athenaBilledBytes(outcome.scannedBytes)} where the 10 MB minimum applies`,
  );
  process.exit(outcome.state === "SUCCEEDED" ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
