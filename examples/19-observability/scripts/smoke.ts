// vp run obs:smoke
//   node scripts/smoke.ts [--url https://xxxx.execute-api.ap-northeast-1.amazonaws.com]
//
// Sends a handful of requests to the deployed API under one trace ID, including
// a 404 and a 409, so there is something to look for in the logs, the metrics
// and the traces. Creates one note and deletes it.
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";
import { z } from "zod";
import { formatTraceparent, toXRayTraceId } from "../src/trace-context.ts";

const STACK = "AihObservability";
const { values } = parseArgs({ options: { url: { type: "string" } } });
const createdSchema = z.object({ id: z.string().min(1) });

try {
  let url = values.url;
  if (url === undefined) {
    const { target } = await preflight({ access: "mutate", action: "send test requests to the API", stack: STACK });
    url = requireOutput(await readStackOutputs(process.cwd(), STACK, target.region), "ApiUrl");
  }

  const traceId = randomBytes(16).toString("hex");
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(new URL(path, url), {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        // A new parent ID per request, the same trace ID for all of them.
        traceparent: formatTraceparent({ traceId, parentId: randomBytes(8).toString("hex"), sampled: true }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    console.log(`${String(response.status)}  ${method} ${path}  x-request-id: ${response.headers.get("x-request-id")}`);
    return response;
  };

  console.log(`api: ${url}`);
  await call("GET", "/health");
  const created = createdSchema.parse(await (await call("POST", "/notes", { title: "obs smoke" })).json());
  await call("GET", `/notes/${created.id}`);
  // A stale version on purpose: one 409 for the NoteConflicts metric.
  await call("PUT", `/notes/${created.id}`, { title: "stale", body: "", expectedVersion: 99 });
  await call("GET", "/notes/aih-smoke-missing");
  await call("DELETE", `/notes/${created.id}`);

  console.log(`\ntraceparent trace ID sent: ${traceId}`);
  console.log(`the same ID in X-Ray's notation: ${toXRayTraceId(traceId)}`);
  console.log("Lambda may have traced these requests under IDs of its own; the log lines show which.");
  console.log("next: vp run obs:query --name request --id <an x-request-id from above>");
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
