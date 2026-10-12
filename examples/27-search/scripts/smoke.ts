// vp run search:smoke
//   node scripts/smoke.ts [--url https://xxxx.lambda-url.ap-northeast-1.on.aws/]
//
// Calls the deployed function URL after `vp run search:seed`: unsigned (must be
// refused), a search as each owner, and one answer. BILLED: three embeddings and one
// short answer.

import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import * as v from "valibot";

import { sseData } from "@aih/example-17-ai/src/client.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { answerEventSchema, searchResponseSchema } from "../src/contract.ts";
import { signedPost } from "./sign.ts";

const { values } = parseArgs({ options: { url: { type: "string" } } });

try {
  const { target } = await preflight({
    access: "mutate",
    action: "search and answer through the deployed function URL (billed)",
    stack: "AihSearch",
  });
  const base =
    values.url ??
    requireOutput(await readStackOutputs(process.cwd(), "AihSearch", target.region), "FunctionUrl");
  const searchUrl = new URL("/search", base);
  const body = JSON.stringify({ query: "支払いのトラブル" });
  console.log(`url: ${searchUrl.href}`);

  const unsigned = await fetch(searchUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-notes-owner": "alice" },
    body,
  });
  await unsigned.body?.cancel();
  if (unsigned.status !== 403) {
    throw new Error(`an unsigned request answered ${unsigned.status}, expected 403`);
  }
  console.log("ok   an unsigned request is refused (403)");

  const search = async (owner: string) => {
    const response = await signedPost(searchUrl, target.region, owner, body);
    if (!response.ok) {
      throw new Error(`search as ${owner} answered ${response.status}: ${await response.text()}`);
    }
    return v.parse(searchResponseSchema, await response.json());
  };

  // The query shares no word with the seed notes. Only the index can find them, and
  // the indexer may still be working through the stream.
  let alice = await search("alice");
  for (let attempt = 0; attempt < 12 && alice.hits.length === 0; attempt += 1) {
    console.log("     nothing by meaning yet, waiting 5 s for the indexer");
    await sleep(5_000);
    alice = await search("alice");
  }
  if (alice.meaning !== "used" || alice.hits.length === 0) {
    throw new Error(`alice found nothing by meaning: ${JSON.stringify(alice)}`);
  }
  for (const hit of alice.hits) {
    console.log(`     alice: ${hit.noteId} ${hit.title} [${hit.matched.join(", ")}]`);
  }
  const bob = await search("bob");
  for (const hit of bob.hits) {
    console.log(`     bob:   ${hit.noteId} ${hit.title} [${hit.matched.join(", ")}]`);
  }
  const leaked = [
    ...alice.hits.filter((hit) => !hit.noteId.startsWith("0000000a")),
    ...bob.hits.filter((hit) => !hit.noteId.startsWith("0000000b")),
  ];
  if (leaked.length > 0) {
    throw new Error(`a search returned another owner's note: ${JSON.stringify(leaked)}`);
  }
  console.log("ok   each owner found only their own notes");

  const answer = await signedPost(
    new URL("/answers", base),
    target.region,
    "alice",
    JSON.stringify({ question: "決済で何が起きて、どう直すことにした?" }),
  );
  if (!answer.ok || answer.body === null) {
    throw new Error(`the answer request answered ${answer.status}: ${await answer.text()}`);
  }
  for await (const data of sseData(answer.body)) {
    const event = v.parse(answerEventSchema, JSON.parse(data));
    if (event.type === "sources") {
      console.log(`     sources: ${event.sources.map((s) => `[${s.n}] ${s.title}`).join(", ")}`);
    } else if (event.type === "delta") {
      process.stdout.write(event.text);
    } else if (event.type === "done") {
      process.stdout.write("\n");
      console.log(
        `ok   ${event.stopReason}, cited ${JSON.stringify(event.citations)}, unknown ${JSON.stringify(event.unknownCitations)}`,
      );
      if (event.usage !== null) {
        console.log(`     tokens in/out: ${event.usage.inputTokens}/${event.usage.outputTokens}`);
      }
    } else {
      throw new Error(`the answer ended with ${event.code}`);
    }
  }
  console.log(`checked at ${new Date().toISOString()}`);
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
