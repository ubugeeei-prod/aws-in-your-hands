// vp run rds:smoke
//   node scripts/smoke.ts [--url https://xxxx.execute-api.ap-northeast-1.amazonaws.com]
// Goes through API Gateway, Lambda, IAM, and the RDS instance. Creates one note and deletes it.

import { parseArgs } from "node:util";

import * as v from "valibot";

import { noteSchema } from "@aih/example-13-sql/src/contract.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { READ_FROM_HEADER, SEEN_HEADER } from "../src/app.ts";
import { RDS_STACK } from "../src/config.ts";

const { values } = parseArgs({ options: { url: { type: "string" } } });
const healthSchema = v.object({ status: v.literal("ok"), db: v.string(), replica: v.boolean() });

try {
  let url = values.url;
  if (url === undefined) {
    const { target } = await preflight({
      access: "mutate",
      action: "smoke test the deployed API",
      stack: RDS_STACK,
    });
    url = requireOutput(await readStackOutputs(process.cwd(), RDS_STACK, target.region), "ApiUrl");
  }
  console.log(`api: ${url}`);
  const call = async (method: string, path: string, body?: unknown, seen?: string | null) => {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(seen ? { [SEEN_HEADER]: seen } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `${method} ${path}: ${response.status} (request ${response.headers.get("x-request-id")}): ${text}`,
      );
    }
    return { text, headers: response.headers };
  };

  const health = v.parse(healthSchema, JSON.parse((await call("GET", "/health")).text));
  console.log(`ok   health (db ${health.db}, replica ${health.replica})`);

  const created = await call("POST", "/notes", { title: `smoke ${new Date().toISOString()}` });
  const note = v.parse(noteSchema, JSON.parse(created.text));
  const seen = created.headers.get(SEEN_HEADER);
  console.log(`ok   created ${note.id}`);
  if (health.replica && seen === null) {
    throw new Error(`a write with a replica configured came back without ${SEEN_HEADER}`);
  }

  // With the position from the write, this must find the note, replica or not.
  const read = await call("GET", `/notes/${note.id}`, undefined, seen);
  console.log(`ok   read it back (from ${read.headers.get(READ_FROM_HEADER) ?? "primary"})`);

  await call("DELETE", `/notes/${note.id}`);
  console.log("ok   deleted");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
