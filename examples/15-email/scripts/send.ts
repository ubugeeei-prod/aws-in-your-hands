// vp run mail:send --to you@example.com [--id share-1] [--by Aiko] [--title "Trip plan"]
//
// Sends one real mail through the deployed API, twice with the same ID, and
// shows that the second request sends nothing. SES bills each accepted message.

import { parseArgs } from "node:util";

import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import {
  errorSchema,
  shareNotificationResultSchema,
  shareNotificationSchema,
} from "../src/contract.ts";
import { signedFetch } from "./signed-fetch.ts";

const { values } = parseArgs({
  options: {
    to: { type: "string" },
    id: { type: "string", default: `smoke-${Date.now()}` },
    by: { type: "string", default: "AWS in Your Hands" },
    title: { type: "string", default: "A note shared from the smoke test" },
  },
});

try {
  if (values.to === undefined) {
    throw new Error(
      "--to is required. In the SES sandbox it must be an address you verified, or a mailbox simulator address.",
    );
  }
  const body = v.parse(shareNotificationSchema, {
    notificationId: values.id,
    to: values.to,
    sharedBy: values.by,
    noteId: "smoke",
    noteTitle: values.title,
  });

  const { target } = await preflight({
    access: "mutate",
    action: `send one mail to ${body.to}`,
    stack: "AihEmail",
  });
  const api = requireOutput(
    await readStackOutputs(process.cwd(), "AihEmail", target.region),
    "ApiUrl",
  );
  const post = () =>
    signedFetch(new URL("/share-notifications", api), target.region, {
      method: "POST",
      body: JSON.stringify(body),
    });

  for (const attempt of ["first", "second"]) {
    const response = await post();
    const json: unknown = await response.json();
    if (!response.ok) {
      const failure = v.safeParse(errorSchema, json);
      throw new Error(
        failure.success
          ? `${response.status} ${failure.output.error.code}: ${failure.output.error.message} (request ${failure.output.error.requestId})`
          : `${response.status} ${JSON.stringify(json)}`,
      );
    }
    const result = v.parse(shareNotificationResultSchema, json);
    console.log(`${attempt} request: ${response.status} ${JSON.stringify(result)}`);
    if (attempt === "second" && result.status === "accepted") {
      throw new Error("the second request with the same notificationId was sent again");
    }
  }
  console.log(
    `\nnotificationId ${body.notificationId}. Follow it with: vp run mail:status --id ${body.notificationId}`,
  );
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
