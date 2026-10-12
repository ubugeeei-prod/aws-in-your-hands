// vp run lmi:smoke
//   node scripts/smoke.ts [--url https://xxxx.execute-api.ap-northeast-1.amazonaws.com]
//
// Exercises the deployed API through the chapter 04 client, then sends a burst of
// simultaneous requests. Unlike the tests, this goes through API Gateway and Lambda
// to the instances, and it creates (then tries to delete) a real note.

import { parseArgs } from "node:util";

import { ApiError, createNotesClient } from "@aih/example-04-http-api/src/client.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { MANAGED_INSTANCES_STACK } from "../src/config.ts";

const BURST = 10;

const { values } = parseArgs({ options: { url: { type: "string" } } });

try {
  let url = values.url;
  if (url === undefined) {
    const { target } = await preflight({
      access: "mutate",
      action: "smoke test the API on Managed Instances",
      stack: MANAGED_INSTANCES_STACK,
    });
    url = requireOutput(
      await readStackOutputs(process.cwd(), MANAGED_INSTANCES_STACK, target.region),
      "ApiUrl",
    );
  }
  const client = createNotesClient(url);
  console.log(`api: ${url}`);

  const health = await client.health();
  console.log(`ok   health (stage ${health.stage})`);

  const note = await client.create({
    title: `smoke ${new Date().toISOString()}`,
    body: "created by lmi:smoke",
  });
  console.log(`ok   created ${note.id}`);

  // Each worker thread of each execution environment holds its own Map. A read that
  // lands on another one has never seen the note: a 404 here is the design showing.
  try {
    await client.get(note.id);
    console.log("ok   read it back (the same worker thread answered)");
    await client.remove(note.id);
    console.log("ok   deleted it");
  } catch (error) {
    if (error instanceof ApiError && error.code === "not_found") {
      console.log(
        `note read-back returned 404 (request ${error.requestId}): another worker thread or execution environment answered.`,
      );
    } else {
      throw error;
    }
  }

  // Sent together, so several are in flight in one execution environment at once.
  const answers = await Promise.all(
    Array.from({ length: BURST }, () => fetch(new URL("/health", url))),
  );
  const ids = new Set(answers.map((answer) => answer.headers.get("x-request-id")));
  const refused = answers.filter((answer) => answer.status !== 200).map((answer) => answer.status);
  if (refused.length > 0) {
    throw new Error(
      `${refused.length} of ${BURST} simultaneous requests failed: ${refused.join(", ")}`,
    );
  }
  if (ids.size !== BURST) {
    throw new Error(`${BURST} simultaneous requests carried only ${ids.size} distinct request IDs`);
  }
  console.log(`ok   ${BURST} simultaneous requests, ${ids.size} distinct request IDs`);
  console.log(`checked at ${new Date().toISOString()}`);
} catch (error) {
  console.error(
    "FAIL",
    error instanceof ApiError
      ? `${error.status} ${error.code} (request ${error.requestId})`
      : error,
  );
  process.exit(1);
}
