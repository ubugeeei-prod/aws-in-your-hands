// vp run webfn:smoke
//   node scripts/smoke.ts [--url https://xxxx.yyy.lambda-web.ap-northeast-1.on.aws] [--count 20]
//
// Calls the deployed endpoint with signed requests, through the typed client of chapter 04.
// It creates (then deletes) a real note, and counts which upload answered each request.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { defaultProvider } from "@aws-sdk/credential-provider-node";
import * as v from "valibot";

import { ApiError, createNotesClient } from "@aih/example-04-http-api/src/client.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";

import { RELEASE_HEADER } from "../src/app.ts";
import { OUTPUTS_FILE, STACK } from "../src/names.ts";
import { signedFetch } from "../src/sign.ts";

const { values } = parseArgs({
  options: { url: { type: "string" }, count: { type: "string", default: "20" } },
});

// `cdk deploy --outputs-file` writes { "<stack>": { "<output>": "<value>" } }.
const outputsSchema = v.object({
  [STACK]: v.object({ EndpointUrl: v.pipe(v.string(), v.url()) }),
});

function deployedUrl(): string {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(OUTPUTS_FILE, "utf8"));
  } catch (error) {
    throw new Error(
      `${OUTPUTS_FILE} is missing. Deploy with a release first (vp run webfn:cfn:deploy -c stable=...), or pass --url.`,
      { cause: error },
    );
  }
  const stack = v.parse(outputsSchema, json)[STACK];
  if (stack === undefined) {
    throw new Error(`${OUTPUTS_FILE} has no outputs for ${STACK}`);
  }
  return stack.EndpointUrl;
}

try {
  const count = v.parse(
    v.pipe(v.string(), v.regex(/^\d{1,3}$/), v.transform(Number), v.minValue(1)),
    values.count,
  );
  const url = values.url ?? deployedUrl();
  const { target } = await preflight({
    access: "mutate",
    action: "smoke test the Web Function endpoint",
    stack: STACK,
  });
  const signed = signedFetch(target.region, defaultProvider());
  const client = createNotesClient(url, signed);
  console.log(`endpoint: ${url}`);

  // The endpoint is IamAuth: without a signature, Lambda answers before the server is reached.
  const unsigned = await fetch(`${url}/health`);
  if (unsigned.ok) {
    throw new Error(
      `an unsigned request was answered with ${unsigned.status}: the endpoint is open`,
    );
  }
  console.log(`ok   an unsigned request is refused (${unsigned.status})`);

  const health = await client.health();
  console.log(`ok   health (stage ${health.stage})`);

  const note = await client.create({
    title: `smoke ${new Date().toISOString()}`,
    body: "created by webfn:smoke",
  });
  console.log(`ok   created ${note.id}`);
  // The notes are in memory. Another execution environment, or the other revision, has never seen this one.
  try {
    await client.get(note.id);
    await client.remove(note.id);
    console.log("ok   read it back and deleted it (the same execution environment answered)");
  } catch (error) {
    if (error instanceof ApiError && error.code === "not_found") {
      console.log(
        `note read-back returned 404 (request ${error.requestId}): another environment answered.`,
      );
    } else {
      throw error;
    }
  }

  const answeredBy = new Map<string, number>();
  let lastRequestId: string | null = null;
  for (let index = 0; index < count; index += 1) {
    const response = await signed(`${url}/health`);
    if (!response.ok) {
      throw new Error(
        `GET /health answered ${response.status} (${response.headers.get("lambda-web-error-type") ?? "no error type"})`,
      );
    }
    const release = response.headers.get(RELEASE_HEADER) ?? "(no release header)";
    answeredBy.set(release, (answeredBy.get(release) ?? 0) + 1);
    lastRequestId = response.headers.get("lambda-web-request-id");
  }
  for (const [release, answers] of answeredBy) {
    console.log(`ok   ${answers}/${count} answered by release ${release}`);
  }
  console.log(`last lambda-web-request-id: ${lastRequestId ?? "(none)"}`);
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
