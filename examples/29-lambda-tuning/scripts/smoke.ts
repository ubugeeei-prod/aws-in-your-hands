// vp run tune:smoke
//   node scripts/smoke.ts [--url https://xxxx.execute-api.ap-northeast-1.amazonaws.com] [--count 20]
//
// Calls the deployed API a number of times, one after another, and prints how long each
// call took as seen from here. Creates one note and deletes it. The first call after a
// deploy or a quiet spell is the one that may start cold.

import { parseArgs } from "node:util";

import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

const STACK = "AihLambdaTuning";

const argsSchema = v.object({
  url: v.optional(v.pipe(v.string(), v.url(), v.regex(/^https:\/\//, "Must be an https URL."))),
  // "20" becomes 20; "many" becomes NaN, which v.number() refuses.
  count: v.optional(
    v.pipe(
      v.string(),
      v.transform(Number),
      v.number(),
      v.integer(),
      v.minValue(1),
      v.maxValue(200),
    ),
    "20",
  ),
});
const createdSchema = v.object({ id: v.pipe(v.string(), v.minLength(1)) });

try {
  const { values } = parseArgs({ options: { url: { type: "string" }, count: { type: "string" } } });
  const args = v.parse(argsSchema, values);
  let url = args.url;
  if (url === undefined) {
    const { target } = await preflight({
      access: "mutate",
      action: "send test requests to the API",
      stack: STACK,
    });
    url = requireOutput(await readStackOutputs(process.cwd(), STACK, target.region), "ApiUrl");
  }

  const call = async (method: string, path: string, body?: unknown) => {
    const startedAt = performance.now();
    const response = await fetch(new URL(path, url), {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const text = await response.text();
    console.log(
      `${String(response.status)}  ${(performance.now() - startedAt).toFixed(0).padStart(5)} ms  ${method} ${path}  x-request-id: ${response.headers.get("x-request-id")}`,
    );
    return text;
  };

  console.log(`api: ${url}`);
  const created = v.parse(
    createdSchema,
    JSON.parse(await call("POST", "/notes", { title: "tuning smoke" })),
  );
  for (let index = 0; index < args.count; index++) {
    await call("GET", `/notes/${created.id}`);
  }
  await call("DELETE", `/notes/${created.id}`);
  console.log(
    "\nThe times above include the network from here. Lambda's own numbers: vp run tune:report",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
