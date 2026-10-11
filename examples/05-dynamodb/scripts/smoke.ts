// vp run notes:smoke
//   node scripts/smoke.ts [--url https://xxxx.execute-api.ap-northeast-1.amazonaws.com]
// Writes one real note through the deployed API, then removes it.
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
      action: "smoke test the deployed notes API",
      stack: "AihNotes",
    });
    url = requireOutput(await readStackOutputs(process.cwd(), "AihNotes", target.region), "ApiUrl");
  }
  const client = createNotesClient(url);
  const health = await client.health();
  console.log(`api: ${url} (stage ${health.stage}, store ${health.store})`);
  if (health.store !== "dynamodb") {
    throw new Error(`the deployed API reports store "${health.store}", expected "dynamodb"`);
  }

  const note = await client.create({ title: `smoke ${new Date().toISOString()}`, body: "v1" });
  console.log(`ok   created ${note.id} at version ${note.version}`);

  // Unlike chapter 04, this read must succeed whichever execution environment answers.
  const readBack = await client.get(note.id);
  if (readBack.version !== 1) {
    throw new Error(`read back version ${readBack.version}, expected 1`);
  }
  console.log("ok   read it back");

  const updated = await client.update(note.id, { title: note.title, body: "v2", expectedVersion: 1 });
  if (updated.status !== "updated" || updated.note.version !== 2) {
    throw new Error("the update based on the current version was not applied");
  }
  console.log("ok   updated to version 2");

  const stale = await client.update(note.id, { title: note.title, body: "stale", expectedVersion: 1 });
  if (stale.status !== "conflict" || stale.current.body !== "v2") {
    throw new Error("an update based on a stale version was not refused");
  }
  console.log("ok   stale update refused; stored note unchanged");

  await client.remove(note.id);
  const gone = await client.get(note.id).catch((error: unknown) => error);
  if (!(gone instanceof ApiError) || gone.status !== 404) {
    throw new Error("the note is still readable after delete");
  }
  console.log(`ok   deleted\nchecked at ${new Date().toISOString()}`);
} catch (error) {
  console.error(
    "FAIL",
    error instanceof ApiError ? `${error.status} ${error.code} (request ${error.requestId})` : error,
  );
  process.exit(1);
}
