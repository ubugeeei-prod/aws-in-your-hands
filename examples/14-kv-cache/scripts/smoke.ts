// vp run kv:smoke
//   node scripts/smoke.ts [--url https://xxxx.execute-api.ap-northeast-1.amazonaws.com]
// Goes through API Gateway, Lambda, IAM, and the store. Writes a few counter
// and cache entries, all of which expire on their own.

import { parseArgs } from "node:util";

import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { healthSchema, itemListSchema } from "../src/contract.ts";

const { values } = parseArgs({ options: { url: { type: "string" } } });

try {
  let url = values.url;
  if (url === undefined) {
    const { target } = await preflight({
      access: "mutate",
      action: "smoke test the deployed API",
      stack: "AihKvCache",
    });
    url = requireOutput(
      await readStackOutputs(process.cwd(), "AihKvCache", target.region),
      "ApiUrl",
    );
  }
  console.log(`api: ${url}`);

  const health = await fetch(`${url}/health`);
  if (health.status !== 200) {
    throw new Error(`health: expected 200, got ${health.status}: ${await health.text()}`);
  }
  const { store } = v.parse(healthSchema, await health.json());
  console.log(`ok   health (store ${store})`);

  // Counted by source address: a run within a minute of the last one starts with part of the budget spent.
  let limit: number | undefined;
  let refusedAt: number | undefined;
  // A fixed window can end mid-run once, so 2 x limit + 1 requests always meet a refusal.
  for (let request = 1; request <= 2 * (limit ?? 5) + 1 && refusedAt === undefined; request++) {
    const response = await fetch(`${url}/items`);
    const requestId = response.headers.get("x-request-id");
    if (response.status === 429) {
      refusedAt = request;
      console.log(
        `ok   request ${request}: 429, retry-after ${response.headers.get("retry-after")} s`,
      );
    } else if (response.status === 200) {
      limit = Number(response.headers.get("ratelimit-limit"));
      const list = v.parse(itemListSchema, await response.json());
      console.log(
        `ok   request ${request}: 200, x-cache ${response.headers.get("x-cache")}, age ${response.headers.get("age")} s, ` +
          `${list.items.length} items, remaining ${response.headers.get("ratelimit-remaining")}`,
      );
    } else {
      throw new Error(
        `request ${request}: unexpected ${response.status} (request ${requestId}): ${await response.text()}`,
      );
    }
  }

  if (refusedAt === undefined) {
    // Expected with KV_STORE=memory once Lambda runs more than one execution environment.
    console.log(
      `note no request was refused. With store "memory" each execution environment counts on its own.`,
    );
    if (store !== "memory") {
      throw new Error("a shared store never refused a request");
    }
  }
  console.log(`checked at ${new Date().toISOString()}`);
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
