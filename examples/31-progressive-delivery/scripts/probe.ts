// vp run rollout:probe [-- --count 200] [--url http://localhost:8787] [--client-id alice]
//   node scripts/probe.ts ...
//
// Sends GET /health over and over and counts which version answered. Without --url it
// reads the deployed API's address from the stack. It creates nothing.

import { parseArgs } from "node:util";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { formatTally, type Sample, tally } from "../src/probe.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    count: { type: "string", default: "100" },
    "client-id": { type: "string" },
  },
});

try {
  const count = Number(values.count);
  // The stage lets 10 requests a second through. One at a time stays under that.
  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    throw new Error("--count must be a whole number from 1 to 1000.");
  }
  let url = values.url;
  if (url === undefined) {
    const { target } = await preflight({
      access: "observe",
      action: "probe the deployed API",
      stack: "AihProgressive",
    });
    url = requireOutput(
      await readStackOutputs(process.cwd(), "AihProgressive", target.region),
      "ApiUrl",
    );
  }
  const headers =
    values["client-id"] === undefined ? undefined : { "x-client-id": values["client-id"] };
  const samples: Sample[] = [];
  for (let sent = 0; sent < count; sent += 1) {
    const response = await fetch(`${url}/health`, { headers });
    await response.arrayBuffer();
    samples.push({
      status: response.status,
      version: response.headers.get("x-app-version") ?? "(no header)",
      flagsOrigin: response.headers.get("x-flags-origin") ?? "(no header)",
    });
  }
  console.log(`api: ${url}`);
  console.log(formatTally(tally(samples)).join("\n"));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
