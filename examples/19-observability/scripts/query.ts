// vp run obs:query:print --name errors            (local: prints the query text)
// vp run obs:query --name request --id <x-request-id>   (AWS: runs it, billed per GB scanned)
//   node scripts/query.ts --name request|trace|errors|slow [--id <id>] [--slow-ms 1000] [--minutes 60] [--print]
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";
import { z } from "zod";
import {
  byRequestId,
  byTraceId,
  type Query,
  renderInsights,
  serverErrorsByRoute,
  slowRequests,
} from "../src/queries.ts";

const STACK = "AihObservability";

const argsSchema = z.object({
  name: z.enum(["request", "trace", "errors", "slow"]),
  id: z.string().optional(),
  "slow-ms": z.coerce.number().positive().default(1000),
  minutes: z.coerce.number().int().positive().max(10_080).default(60),
  print: z.boolean().default(false),
});

const startedSchema = z.object({ queryId: z.string() });
const resultsSchema = z.object({
  status: z.string(),
  results: z.array(z.array(z.object({ field: z.string(), value: z.string() }))).default([]),
  statistics: z.object({ recordsScanned: z.number(), bytesScanned: z.number() }).partial().optional(),
});

function pick(args: z.infer<typeof argsSchema>): Query {
  switch (args.name) {
    case "request":
      return byRequestId(args.id ?? "");
    case "trace":
      return byTraceId(args.id ?? "");
    case "errors":
      return serverErrorsByRoute();
    case "slow":
      return slowRequests(args["slow-ms"]);
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
      id: { type: "string" },
      "slow-ms": { type: "string" },
      minutes: { type: "string" },
      print: { type: "boolean" },
    },
  });
  const args = argsSchema.parse(values);
  const text = renderInsights(pick(args));
  console.log(text);
  if (args.print) {
    process.exit(0);
  }

  const { target } = await preflight({ access: "observe", action: "run a Logs Insights query", stack: STACK });
  const logGroup = requireOutput(await readStackOutputs(process.cwd(), STACK, target.region), "HandlerLogGroupName");
  const end = Math.floor(Date.now() / 1000);
  // The time range is what you pay for: every byte in it is scanned.
  const start = end - args.minutes * 60;
  const { queryId } = startedSchema.parse(
    aws([
      "logs",
      "start-query",
      "--region",
      target.region,
      "--log-group-name",
      logGroup,
      "--start-time",
      String(start),
      "--end-time",
      String(end),
      "--query-string",
      text,
    ]),
  );

  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(1000);
    const response = resultsSchema.parse(
      aws(["logs", "get-query-results", "--region", target.region, "--query-id", queryId]),
    );
    if (response.status === "Running" || response.status === "Scheduled") {
      continue;
    }
    console.log(`\nstatus: ${response.status}, last ${String(args.minutes)} min of ${logGroup}`);
    for (const row of response.results) {
      console.log(
        Object.fromEntries(row.filter((cell) => cell.field !== "@ptr").map((cell) => [cell.field, cell.value])),
      );
    }
    console.log(
      `${String(response.results.length)} rows; scanned ${String(response.statistics?.bytesScanned ?? "?")} bytes`,
    );
    process.exit(response.status === "Complete" ? 0 : 1);
  }
  throw new Error(`query ${queryId} did not finish in 30 seconds`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
