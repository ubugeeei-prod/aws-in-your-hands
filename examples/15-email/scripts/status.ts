// vp run mail:status --id share-1
//
// Reads one notification's state from the deployed API: claimed, rejected,
// sent, delivered, bounced or complained.

import { parseArgs } from "node:util";

import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { notificationStatusSchema } from "../src/contract.ts";
import { signedFetch } from "./signed-fetch.ts";

const { values } = parseArgs({ options: { id: { type: "string" } } });

try {
  if (values.id === undefined) {
    throw new Error("--id is required");
  }
  const { target } = await preflight({
    access: "observe",
    action: "read a notification's state",
    stack: "AihEmail",
  });
  const api = requireOutput(
    await readStackOutputs(process.cwd(), "AihEmail", target.region),
    "ApiUrl",
  );
  const response = await signedFetch(
    new URL(`/share-notifications/${encodeURIComponent(values.id)}`, api),
    target.region,
    {
      method: "GET",
    },
  );
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  console.log(JSON.stringify(v.parse(notificationStatusSchema, await response.json()), null, 2));
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
