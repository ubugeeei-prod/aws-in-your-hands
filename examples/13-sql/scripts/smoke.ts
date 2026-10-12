// vp run sql:smoke
//   node scripts/smoke.ts [--url https://xxxx.execute-api.ap-northeast-1.amazonaws.com]
// Goes through API Gateway, Lambda, IAM, and Aurora DSQL. Creates one note and deletes it.

import { parseArgs } from "node:util";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { errorSchema, healthSchema, noteSchema } from "../src/contract.ts";

const { values } = parseArgs({ options: { url: { type: "string" } } });

try {
  let url = values.url;
  if (url === undefined) {
    const { target } = await preflight({
      access: "mutate",
      action: "smoke test the deployed API",
      stack: "AihSql",
    });
    url = requireOutput(await readStackOutputs(process.cwd(), "AihSql", target.region), "ApiUrl");
  }
  console.log(`api: ${url}`);
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, requestId: response.headers.get("x-request-id"), text };
  };
  const expectStatus = (result: Awaited<ReturnType<typeof call>>, status: number, what: string) => {
    if (result.status !== status) {
      throw new Error(
        `${what}: expected ${status}, got ${result.status} (request ${result.requestId}): ${result.text}`,
      );
    }
  };

  const health = await call("GET", "/health");
  expectStatus(health, 200, "health");
  console.log(`ok   health (db ${healthSchema.parse(JSON.parse(health.text)).db})`);

  const created = await call("POST", "/notes", {
    title: `smoke ${new Date().toISOString()}`,
    body: "sql:smoke",
  });
  expectStatus(created, 201, "create");
  const note = noteSchema.parse(JSON.parse(created.text));
  console.log(`ok   created ${note.id}`);

  // Unlike chapter 04, the read must find it: the database owns the note,
  // whichever execution environment answers.
  expectStatus(await call("GET", `/notes/${note.id}`), 200, "read back");
  console.log("ok   read it back");

  expectStatus(
    await call("PUT", `/notes/${note.id}`, { title: "smoke, edited", expectedVersion: 1 }),
    200,
    "update",
  );
  const stale = await call("PUT", `/notes/${note.id}`, {
    title: "smoke, stale",
    expectedVersion: 1,
  });
  expectStatus(stale, 409, "stale update");
  if (errorSchema.parse(JSON.parse(stale.text)).error.code !== "conflict") {
    throw new Error("a stale update did not answer with the conflict error");
  }
  console.log("ok   stale update refused with 409");

  expectStatus(await call("DELETE", `/notes/${note.id}`), 204, "delete");
  expectStatus(await call("GET", `/notes/${note.id}`), 404, "read after delete");
  console.log("ok   deleted it");
  console.log(`checked at ${new Date().toISOString()}`);
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
