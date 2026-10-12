import { describe, expect, it } from "vite-plus/test";

import { createApp } from "../src/app.ts";
import { collectSummary, sseData, summaryEvents } from "../src/client.ts";
import { createFixtureGateway } from "../src/fixture-gateway.ts";
import { fixtures } from "../src/fixtures.ts";
import { NOTE, setupSummarizer } from "./helpers.ts";

/** The bytes the real app sends for a fixture. */
async function wireBytes(name: keyof typeof fixtures): Promise<Uint8Array> {
  const app = createApp({
    env: {
      AI_BACKEND: "fixture",
      BEDROCK_MODEL_ID: "jp.amazon.nova-2-lite-v1:0",
      AWS_REGION: "ap-northeast-1",
      MAX_OUTPUT_TOKENS: 400,
      INFERENCE_TIMEOUT_MS: 30_000,
      LOG_LEVEL: "error",
      STAGE: "test",
    },
    summarize: setupSummarizer(createFixtureGateway(fixtures[name])).summarize,
    log: () => {},
    newRequestId: () => "req-1",
    now: () => 0,
  });
  const response = await app.request("/summaries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(NOTE),
  });
  return new Uint8Array(await response.arrayBuffer());
}

/** A body that delivers `bytes` in chunks of `size`, then ends or fails. */
function chunked(
  bytes: Uint8Array,
  size: number,
  ending: "close" | "error" = "close",
): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset < bytes.length) {
        controller.enqueue(bytes.slice(offset, offset + size));
        offset += size;
      } else if (ending === "close") {
        controller.close();
      } else {
        controller.error(new Error("connection reset"));
      }
    },
  });
}

const SUMMARY =
  "金曜のリリースに向けて、残りは決済の結合テストと負荷試験の2つです。担当は決まっていて、水曜に進み具合を確認します。";

describe("reading the stream", () => {
  it("reads the same summary however the bytes are split, even inside a character", async () => {
    const bytes = await wireBytes("complete");
    for (const size of [1, 2, 3, 7, 64, bytes.length]) {
      const result = await collectSummary(summaryEvents(chunked(bytes, size)));
      expect(result, `chunks of ${size}`).toMatchObject({ status: "complete", text: SUMMARY });
    }
  });

  it("is complete only when the whole stream arrived: every shorter prefix is incomplete", async () => {
    const bytes = await wireBytes("complete");
    for (let length = 0; length < bytes.length; length += 1) {
      for (const ending of ["close", "error"] as const) {
        const result = await collectSummary(
          summaryEvents(chunked(bytes.slice(0, length), 16, ending)),
        );
        expect(result.status, `${length} of ${bytes.length} bytes, then ${ending}`).toBe(
          "incomplete",
        );
        if (result.status === "incomplete") {
          // What did arrive is a prefix of the real text, never something else.
          expect(SUMMARY.startsWith(result.partial)).toBe(true);
        }
      }
    }
  });

  it("reports a summary the model cut short as incomplete, with the text so far", async () => {
    const result = await collectSummary(summaryEvents(chunked(await wireBytes("max-tokens"), 32)));
    expect(result).toEqual({
      status: "incomplete",
      partial: "金曜のリリースに向けて、残りは決済の結合テストと",
      reason: "stopped_early",
      retryable: false,
    });
  });

  it("stops at an event that breaks the contract instead of passing it on", async () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    const wrongShape = encode('event: delta\ndata: {"type":"delta","text":42}\n\n');
    const notJson = encode("event: delta\ndata: <html>502 Bad Gateway</html>\n\n");
    for (const bytes of [wrongShape, notJson]) {
      expect(await collectSummary(summaryEvents(chunked(bytes, 16)))).toEqual({
        status: "incomplete",
        partial: "",
        reason: "bad_output",
        retryable: false,
      });
    }
  });

  it("ignores anything after the terminal event", async () => {
    const bytes = await wireBytes("complete");
    const extra = new TextEncoder().encode(
      'event: delta\ndata: {"type":"delta","text":"late"}\n\n',
    );
    const result = await collectSummary(
      summaryEvents(chunked(new Uint8Array([...bytes, ...extra]), 64)),
    );
    expect(result).toMatchObject({ status: "complete", text: SUMMARY });
  });

  it("joins the data lines of one event and skips comments", async () => {
    const bytes = new TextEncoder().encode(": keep-alive\n\nevent: x\ndata: a\ndata: b\n\n");
    const all: string[] = [];
    for await (const data of sseData(chunked(bytes, 5))) {
      all.push(data);
    }
    expect(all).toEqual(["a\nb"]);
  });
});
