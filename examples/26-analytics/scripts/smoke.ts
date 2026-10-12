// vp run analytics:smoke
//   node scripts/smoke.ts [--url https://xxxx.execute-api.ap-northeast-1.amazonaws.com]
//
// Sends a handful of requests to the deployed API, including a 404 and a 409,
// so that there are records to query. Creates one note and deletes it.

import { parseArgs } from "node:util";

import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { dayOf } from "../src/partition.ts";

const STACK = "AihAnalytics";
const { values } = parseArgs({ options: { url: { type: "string" } } });
const createdSchema = v.object({ id: v.pipe(v.string(), v.minLength(1)) });

try {
  let url = values.url;
  if (url === undefined) {
    const { target } = await preflight({
      access: "mutate",
      action: "send test requests to the API",
      stack: STACK,
    });
    url = requireOutput(await readStackOutputs(process.cwd(), STACK, target.region), "ApiUrl");
  }

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(new URL(path, url), {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    console.log(
      `${String(response.status)}  ${method} ${path}  x-request-id: ${response.headers.get("x-request-id")}`,
    );
    return response;
  };

  console.log(`api: ${url}`);
  await call("GET", "/health");
  const created = v.parse(
    createdSchema,
    await (await call("POST", "/notes", { title: "analytics smoke" })).json(),
  );
  await call("GET", `/notes/${created.id}`);
  await call("PUT", `/notes/${created.id}`, { title: "edited", body: "", expectedVersion: 1 });
  // A stale version on purpose: one update_conflicted record.
  await call("PUT", `/notes/${created.id}`, { title: "stale", body: "", expectedVersion: 1 });
  await call("GET", "/notes/aih-smoke-missing");
  await call("DELETE", `/notes/${created.id}`);

  const day = dayOf(new Date());
  console.log(
    "\nFirehose writes an object when its buffer interval ends (60 s for json, 300 s for parquet).",
  );
  console.log(`after that: vp run analytics:query --name actions --from ${day} --to ${day}`);
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
