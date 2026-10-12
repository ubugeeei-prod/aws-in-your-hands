// vp run isolates:smoke
//   node scripts/smoke.ts [--url http://xxxx.ap-northeast-1.elb.amazonaws.com]
//
// Calls the deployed service the way a client would: health, create, read, delete.
// Reads the stack's ServiceUrl with your credentials unless --url is given.

import { parseArgs } from "node:util";

import * as v from "valibot";

import { healthSchema, noteSchema } from "@aih/example-04-http-api/src/contract.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { ISOLATES_STACK } from "../src/config.ts";

const { values } = parseArgs({ options: { url: { type: "string" } } });

try {
  let url = values.url;
  if (url === undefined) {
    const { target } = await preflight({
      access: "observe",
      action: "call the service",
      stack: ISOLATES_STACK,
    });
    url = requireOutput(
      await readStackOutputs(process.cwd(), ISOLATES_STACK, target.region),
      "ServiceUrl",
    );
  }

  const health = await fetch(`${url}/health`);
  console.log(`GET /health -> ${health.status}`, v.parse(healthSchema, await health.json()));

  const created = await fetch(`${url}/notes`, {
    method: "POST",
    body: JSON.stringify({ title: "smoke", body: "from isolates:smoke" }),
  });
  const note = v.parse(noteSchema, await created.json());
  console.log(`POST /notes -> ${created.status} ${note.id}`);

  // With more than one task, this read may reach a task that never saw the note: each has its own memory.
  const read = await fetch(`${url}/notes/${note.id}`);
  console.log(`GET /notes/${note.id} -> ${read.status}`);
  const removed = await fetch(`${url}/notes/${note.id}`, { method: "DELETE" });
  console.log(`DELETE /notes/${note.id} -> ${removed.status}`);

  if (health.status !== 200 || created.status !== 201 || read.status !== 200) {
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
