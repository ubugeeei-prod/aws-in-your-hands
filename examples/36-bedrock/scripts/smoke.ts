// vp run bedrock:smoke
//   node scripts/smoke.ts
//
// Calls the deployed function URL: once unsigned, which must be refused, then signed.
// It writes the three fixture notes under the caller's own identity and asks one question
// about them. BILLED: one question, three model calls or so.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import { DynamoDbNoteRepository } from "@aih/example-05-dynamodb/src/dynamodb-repository.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { assistantEvents, collectAnswer } from "../src/client.ts";
import { seededNotes } from "../src/local-notes.ts";
import { signedFetch } from "./sign.ts";

const STACK = "AihBedrock";
const QUESTION = "金曜のリリースまでに残っている作業と担当を教えて";

try {
  const { target } = await preflight({
    access: "mutate",
    action: "write three notes and ask the deployed assistant one question (billed)",
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const base = requireOutput(outputs, "FunctionUrl");

  const unsigned = await fetch(new URL("/me", base));
  await unsigned.body?.cancel();
  if (unsigned.status !== 403) {
    throw new Error(
      `an unsigned request answered ${unsigned.status}, expected 403. Is the URL public?`,
    );
  }
  console.log("ok   an unsigned request is refused (403)");

  const me = await signedFetch("GET", new URL("/me", base), target.region);
  if (!me.ok) {
    throw new Error(`GET /me answered ${me.status}: ${await me.text()}`);
  }
  const { sub } = v.parse(v.object({ sub: v.pipe(v.string(), v.minLength(1)) }), await me.json());
  console.log(`ok   the function sees the signer as ${sub}`);

  const table = new DynamoDbNoteRepository(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: target.region })),
    requireOutput(outputs, "NotesTableName"),
  );
  const { notes } = await (await seededNotes()).list("local-alice", { limit: 20 });
  for (const note of notes) {
    // "already_exists" on a second run is fine.
    await table.create(sub, note);
  }
  console.log(`ok   ${notes.length} notes are stored under that owner`);

  const response = await signedFetch(
    "POST",
    new URL("/assistant", base),
    target.region,
    JSON.stringify({ question: QUESTION }),
  );
  if (!response.ok || response.body === null) {
    throw new Error(`POST /assistant answered ${response.status}: ${await response.text()}`);
  }
  const answer = await collectAnswer(assistantEvents(response.body), (event) => {
    if (event.type === "delta") {
      process.stdout.write(event.text);
    } else if (event.type === "tool") {
      process.stdout.write(`\n[tool ${event.name} ${event.ok ? "ok" : "refused"}]\n`);
    }
  });
  process.stdout.write("\n");
  if (answer.status !== "complete") {
    throw new Error(`the answer did not complete: ${JSON.stringify(answer)}`);
  }
  const { inputTokens, outputTokens, cacheReadInputTokens, cacheWriteInputTokens } = answer.usage;
  console.log(`ok   request ${response.headers.get("x-request-id")}, ${answer.turns} turn(s)`);
  console.log(
    `     tokens in/out ${inputTokens}/${outputTokens}, cache read/write ${cacheReadInputTokens}/${cacheWriteInputTokens}`,
  );
  console.log(`checked at ${new Date().toISOString()}`);
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
