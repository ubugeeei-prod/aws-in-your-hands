// vp run app:smoke:api
//   node scripts/smoke.ts [--url https://xxxx.execute-api.ap-northeast-1.amazonaws.com]
//
// The signed-in path runs only when AIH_ACCESS_TOKEN holds an access token.
// The token is never printed.

import { parseArgs } from "node:util";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { ApiError, createNotesClient } from "../api/src/client.ts";

const { values } = parseArgs({ options: { url: { type: "string" } } });
const token = process.env["AIH_ACCESS_TOKEN"];

const expectRejected = async (label: string, call: Promise<unknown>): Promise<void> => {
  const error = await call.catch((caught: unknown) => caught);
  if (!(error instanceof ApiError) || (error.status !== 401 && error.status !== 403)) {
    throw new Error(
      `${label}: expected 401 or 403, got ${error instanceof ApiError ? error.status : "a successful response"}`,
    );
  }
  console.log(`ok   ${label} is turned away with ${error.status}`);
};

try {
  let url = values.url;
  if (url === undefined) {
    const { target } = await preflight({
      access: token === undefined ? "observe" : "mutate",
      action: "smoke test the deployed notes API",
      stack: "AihNotesApp",
    });
    url = requireOutput(
      await readStackOutputs(process.cwd(), "AihNotesApp", target.region),
      "ApiUrl",
    );
  }
  console.log(`api: ${url}`);

  const anonymous = createNotesClient(url, () => undefined);
  console.log(`ok   health (stage ${(await anonymous.health()).stage})`);
  await expectRejected("a request without a token", anonymous.list());
  await expectRejected(
    "a request with a made-up token",
    createNotesClient(url, () => "not.a.token").list(),
  );

  if (token === undefined) {
    console.log("AIH_ACCESS_TOKEN is not set: the signed-in path was NOT checked.");
  } else {
    const user = createNotesClient(url, () => token);
    const me = await user.me();
    console.log(`ok   signed in as ${me.sub}`);
    const note = await user.create({ title: `smoke ${new Date().toISOString()}`, body: "" });
    const listed = (await user.list()).notes.some((item) => item.id === note.id);
    await user.remove(note.id);
    console.log(
      `ok   created and deleted ${note.id}${listed ? "" : " (not yet in the eventually consistent list)"}`,
    );
  }
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
