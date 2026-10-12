// vp run polly:listen
//   node scripts/listen.ts [--url https://xxxx.lambda-url.ap-northeast-1.on.aws/] [--voice Kazuha]
//
// Asks the deployed function for the audio of one short note, twice. The first call is
// BILLED by Polly (about 70 characters); the second must cost nothing.

import { parseArgs } from "node:util";

import * as v from "valibot";

import { signedPost } from "@aih/example-17-ai/scripts/sign.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { speechResponseSchema } from "../src/contract.ts";
import { VOICE_IDS } from "../src/voices.ts";

const { values } = parseArgs({
  options: { url: { type: "string" }, voice: { type: "string", default: "Kazuha" } },
});

try {
  const voice = v.parse(v.picklist(VOICE_IDS), values.voice);
  const { target } = await preflight({
    access: "mutate",
    action: "synthesize one short note through the deployed function URL (billed)",
    stack: "AihPolly",
  });
  const base =
    values.url ??
    requireOutput(await readStackOutputs(process.cwd(), "AihPolly", target.region), "FunctionUrl");
  const url = new URL("/speech", base);
  // The time makes the text new, so the first call is a miss every time this runs.
  const body = JSON.stringify({
    title: "リリース前の確認",
    body: `金曜のリリースまでに、決済の結合テストと負荷試験を終える。確認した時刻は ${new Date().toISOString()} です。`,
    voice,
  });
  console.log(`url: ${url.href}`);

  const unsigned = await fetch(url, { method: "POST", body });
  await unsigned.body?.cancel();
  if (unsigned.status !== 403) {
    throw new Error(
      `an unsigned request answered ${unsigned.status}, expected 403. Is the URL public?`,
    );
  }
  console.log("ok   an unsigned request is refused (403)");

  const ask = async () => {
    const startedAt = Date.now();
    const response = await signedPost(url, target.region, body);
    if (!response.ok) {
      throw new Error(`the signed request answered ${response.status}: ${await response.text()}`);
    }
    return { ...v.parse(speechResponseSchema, await response.json()), ms: Date.now() - startedAt };
  };

  const first = await ask();
  console.log(
    `ok   first:  ${first.parts.length} part(s), ${first.billedCharacters} characters billed, ${first.ms} ms`,
  );
  const second = await ask();
  console.log(
    `ok   second: ${second.parts.length} part(s), ${second.billedCharacters} characters billed, ${second.ms} ms`,
  );
  if (second.billedCharacters !== 0 || second.parts.some((part) => part.source !== "cache")) {
    throw new Error("the second request was synthesized again: the cache did not hold");
  }

  for (const part of first.parts) {
    const audio = await fetch(part.url);
    const bytes = (await audio.arrayBuffer()).byteLength;
    console.log(`     ${audio.status} ${audio.headers.get("content-type")} ${bytes} bytes`);
  }
  console.log(`     play it: ${first.parts[0]?.url}`);
  console.log(`checked at ${new Date().toISOString()}`);
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
