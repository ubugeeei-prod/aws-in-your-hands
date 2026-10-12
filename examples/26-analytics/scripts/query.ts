// vp run analytics:query:print --name actions --from 2026-10-12 --to 2026-10-12   (prints the SQL)
// vp run analytics:query:local --name routes --from 2026-10-12 --to 2026-10-12    (reads LAKE_DIR)
// vp run analytics:query --name actions --from 2026-10-12 --to 2026-10-12         (AWS: BILLED per byte scanned)
//   node scripts/query.ts --name actions|routes|errors|status --from <day> --to <day> [--print | --local]

import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { athenaBilledBytes } from "../src/cost-inputs.ts";
import { loadObjects } from "../src/local-files.ts";
import { QUALIFIED_TABLE } from "../src/names.ts";
import { dayOf, daySchema } from "../src/partition.ts";
import {
  actionsPerDay,
  errorsPerDay,
  type Query,
  renderAthena,
  requestsPerRoute,
  runLocally,
  statusPerDay,
} from "../src/queries.ts";

const STACK = "AihAnalytics";
const today = dayOf(new Date());

const argsSchema = v.object({
  name: v.picklist(["actions", "routes", "errors", "status"]),
  from: v.optional(daySchema, today),
  to: v.optional(daySchema, today),
  print: v.optional(v.boolean(), false),
  local: v.optional(v.boolean(), false),
});

const startedSchema = v.object({ QueryExecutionId: v.string() });
const executionSchema = v.object({
  QueryExecution: v.object({
    Status: v.object({ State: v.string(), StateChangeReason: v.optional(v.string()) }),
    Statistics: v.optional(v.partial(v.object({ DataScannedInBytes: v.number() }))),
  }),
});
const resultsSchema = v.object({
  ResultSet: v.object({
    Rows: v.array(v.object({ Data: v.array(v.partial(v.object({ VarCharValue: v.string() }))) })),
  }),
});

function pick(args: v.InferOutput<typeof argsSchema>): Query {
  switch (args.name) {
    case "actions":
      return actionsPerDay(args.from, args.to);
    case "routes":
      return requestsPerRoute(args.from, args.to);
    case "errors":
      return errorsPerDay(args.from, args.to);
    case "status":
      return statusPerDay(args.from, args.to);
  }
}

function aws(args: string[]): unknown {
  const result = spawnSync("aws", [...args, "--output", "json"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`aws ${args.slice(0, 2).join(" ")} failed:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

try {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      print: { type: "boolean" },
      local: { type: "boolean" },
    },
  });
  const args = v.parse(argsSchema, values);
  const query = pick(args);
  const sql = renderAthena(query, QUALIFIED_TABLE);
  console.log(sql);
  if (args.print) {
    process.exit(0);
  }

  if (args.local) {
    const directory = process.env["LAKE_DIR"] ?? "dist/lake";
    const result = runLocally(query, loadObjects(directory));
    console.log(`\nfrom ${directory}, by this chapter's model of the query (no SQL was run):`);
    console.table(result.rows);
    console.log(
      `read ${String(result.objects)} objects, ${String(result.bytes)} bytes, in partitions: ${result.partitions.join(", ") || "(none)"}`,
    );
    process.exit(0);
  }

  const { target } = await preflight({
    access: "mutate",
    action: "run an Athena query (billed by bytes scanned; writes a result object)",
    stack: STACK,
  });
  const workGroup = requireOutput(
    await readStackOutputs(process.cwd(), STACK, target.region),
    "WorkGroupName",
  );
  const { QueryExecutionId: id } = v.parse(
    startedSchema,
    aws([
      "athena",
      "start-query-execution",
      "--region",
      target.region,
      // The workgroup decides where results go and how much one query may scan.
      "--work-group",
      workGroup,
      "--query-string",
      sql,
    ]),
  );

  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(1000);
    const { QueryExecution: execution } = v.parse(
      executionSchema,
      aws(["athena", "get-query-execution", "--region", target.region, "--query-execution-id", id]),
    );
    const state = execution.Status.State;
    if (state === "QUEUED" || state === "RUNNING") {
      continue;
    }
    const scanned = execution.Statistics?.DataScannedInBytes;
    console.log(`\nstate: ${state} ${execution.Status.StateChangeReason ?? ""}`.trimEnd());
    if (state === "SUCCEEDED") {
      const results = v.parse(
        resultsSchema,
        aws(["athena", "get-query-results", "--region", target.region, "--query-execution-id", id]),
      );
      // The first row holds the column names.
      for (const row of results.ResultSet.Rows) {
        console.log(row.Data.map((cell) => cell.VarCharValue ?? "").join("\t"));
      }
    }
    console.log(
      scanned === undefined
        ? "scanned: not reported"
        : `scanned ${String(scanned)} bytes; billed as ${String(athenaBilledBytes(scanned))} if the 10 MB minimum applies`,
    );
    process.exit(state === "SUCCEEDED" ? 0 : 1);
  }
  throw new Error(`query ${id} did not finish in 60 seconds`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
