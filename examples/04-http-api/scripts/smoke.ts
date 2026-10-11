// vp run api:smoke
//   node scripts/smoke.ts [--url https://xxxx.execute-api.ap-northeast-1.amazonaws.com]
//
// Exercises the deployed API through the same typed client the tests use.
// Unlike the tests, this goes through API Gateway, IAM, and Lambda, and it
// creates (then deletes) a real note.
import { parseArgs } from "node:util";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";
import { ApiError, createNotesClient } from "../src/client.ts";

const { values } = parseArgs({ options: { url: { type: "string" } } });

try {
  let url = values.url;
  if (url === undefined) {
    const { target } = await preflight({
      access: "mutate",
      action: "smoke test the deployed API",
      stack: "AihHttpApi",
    });
    url = requireOutput(await readStackOutputs(process.cwd(), "AihHttpApi", target.region), "ApiUrl");
  }
  const client = createNotesClient(url);
  console.log(`api: ${url}`);

  const health = await client.health();
  console.log(`ok   health (stage ${health.stage})`);

  const note = await client.create({ title: `smoke ${new Date().toISOString()}`, body: "created by api:smoke" });
  console.log(`ok   created ${note.id}`);

  // The read may be served by a different execution environment than the
  // write. With the in-memory repository of this chapter that environment has
  // never seen the note, so a 404 here is expected behavior worth noticing,
  // not a broken deployment.
  try {
    await client.get(note.id);
    console.log("ok   read it back (same execution environment answered)");
    await client.remove(note.id);
    console.log("ok   deleted it");
  } catch (error) {
    if (error instanceof ApiError && error.code === "not_found") {
      console.log(`note read-back returned 404 (request ${error.requestId}): another execution environment answered.`);
    } else {
      throw error;
    }
  }

  const missing = await client.get("aih-smoke-missing").catch((error: unknown) => error);
  if (!(missing instanceof ApiError) || missing.status !== 404) {
    throw new Error("an unknown note did not answer 404 with the error contract");
  }
  console.log(`ok   unknown note is a 404 (request ${missing.requestId})`);
  console.log(`checked at ${new Date().toISOString()}`);
} catch (error) {
  console.error(
    "FAIL",
    error instanceof ApiError ? `${error.status} ${error.code} (request ${error.requestId})` : error,
  );
  process.exit(1);
}
