// vp run ai:smoke
//   node scripts/smoke.ts [--url https://xxxx.lambda-url.ap-northeast-1.on.aws/]
//
// Calls the deployed function URL: once unsigned, which must be refused, and
// once signed, which streams a summary. BILLED: one short summary.
import { parseArgs } from "node:util";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";
import { collectSummary, summaryEvents } from "../src/client.ts";
import { signedPost } from "./sign.ts";

const { values } = parseArgs({ options: { url: { type: "string" } } });

const NOTE = {
  title: "リリース前の確認",
  body: "金曜のリリースまでに、決済の結合テストと負荷試験を終える。担当は佐藤さんと鈴木さん。水曜の朝会で進み具合を確認する。",
};

try {
  const { target } = await preflight({
    access: "mutate",
    action: "summarize one note through the deployed function URL (billed)",
    stack: "AihAi",
  });
  const base =
    values.url ?? requireOutput(await readStackOutputs(process.cwd(), "AihAi", target.region), "FunctionUrl");
  const url = new URL("/summaries", base);
  const body = JSON.stringify(NOTE);
  console.log(`url: ${url.href}`);

  const unsigned = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
  await unsigned.body?.cancel();
  if (unsigned.status !== 403) {
    throw new Error(`an unsigned request answered ${unsigned.status}, expected 403. Is the URL public?`);
  }
  console.log("ok   an unsigned request is refused (403)");

  const startedAt = Date.now();
  const response = await signedPost(url, target.region, body);
  if (!response.ok || response.body === null) {
    throw new Error(`the signed request answered ${response.status}: ${await response.text()}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("text/event-stream")) {
    throw new Error(`expected text/event-stream, got "${contentType}"`);
  }

  // If the path buffered the response, every delta would arrive at the same moment.
  const arrivals: number[] = [];
  const result = await collectSummary(summaryEvents(response.body), (text) => {
    arrivals.push(Date.now() - startedAt);
    process.stdout.write(text);
  });
  process.stdout.write("\n");

  if (result.status !== "complete") {
    throw new Error(`the summary did not complete: ${result.reason}`);
  }
  console.log(`ok   request ${response.headers.get("x-request-id")}, ${arrivals.length} delta(s)`);
  console.log(`     first delta after ${arrivals[0]} ms, last after ${arrivals.at(-1)} ms`);
  if (result.usage !== null) {
    console.log(`     tokens in/out: ${result.usage.inputTokens}/${result.usage.outputTokens}`);
  }
  console.log(`checked at ${new Date().toISOString()}`);
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
