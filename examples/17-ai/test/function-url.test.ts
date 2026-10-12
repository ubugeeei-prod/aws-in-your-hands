import { Writable } from "node:stream";

import type { Context, LambdaFunctionURLEvent } from "aws-lambda";
import { describe, expect, it } from "vite-plus/test";

import { createApp } from "../src/app.ts";
import { collectSummary, summaryEvents } from "../src/client.ts";
import { createFixtureGateway } from "../src/fixture-gateway.ts";
import { fixtures } from "../src/fixtures.ts";
import { type Awslambda, type Prelude, streamFunctionUrl } from "../src/function-url.ts";
import { sseFrame } from "../src/sse.ts";
import type { ModelGateway } from "../src/summarize.ts";
import { NOTE, setupSummarizer, untilAborted } from "./helpers.ts";

// A stand-in for the `awslambda` global, which exists only on Lambda. It records what the
// adapter hands over. It says nothing about what the real runtime does with it.
function fakeRuntime() {
  const seen: { prelude?: Prelude } = {};
  const runtime: Awslambda = {
    streamifyResponse: (handler) => handler,
    HttpResponseStream: {
      from(responseStream, prelude) {
        seen.prelude = prelude;
        return responseStream;
      },
    },
  };
  return { runtime, seen };
}

/** A response stream that keeps what was written, or fails once `failAfter` chunks arrived. */
function sink(failAfter = Number.POSITIVE_INFINITY) {
  const chunks: Buffer[] = [];
  const stream = Object.assign(
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        if (chunks.length >= failAfter) {
          done(new Error("the caller is gone"));
          return;
        }
        chunks.push(chunk);
        done();
      },
    }),
    { setContentType: () => {} },
  );
  return { stream, chunks, bytes: () => new Uint8Array(Buffer.concat(chunks)) };
}

// Only the fields the adapter reads. The handler never looks at the context.
const context = {} as Context;
const event = (path: string, method: string, body?: unknown) =>
  ({
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: { "content-type": "application/json" },
    requestContext: {
      domainName: "abc.lambda-url.ap-northeast-1.on.aws",
      http: { method, path },
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    isBase64Encoded: false,
  }) as unknown as LambdaFunctionURLEvent;

function setup(gateway: ModelGateway) {
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
    summarize: setupSummarizer(gateway).summarize,
    log: () => {},
    newRequestId: () => "req-1",
    now: () => 0,
  });
  const { runtime, seen } = fakeRuntime();
  return { handler: streamFunctionUrl(app, runtime), seen };
}

describe("the function URL adapter, against a stand-in for awslambda", () => {
  it("sends the status and headers as the prelude, then the events as the body", async () => {
    const { handler, seen } = setup(createFixtureGateway(fixtures.complete));
    const out = sink();
    await handler(event("/summaries", "POST", NOTE), out.stream, context);

    expect(seen.prelude).toEqual({
      statusCode: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "x-request-id": "req-1",
      },
    });
    expect(out.stream.writableFinished).toBe(true);
    // One write per event: nothing was gathered up before it was sent.
    expect(out.chunks.length).toBeGreaterThan(2);
    const body = new Blob([out.bytes()]).stream();
    expect(await collectSummary(summaryEvents(body))).toMatchObject({ status: "complete" });
  });

  it("answers an ordinary error with its status, as JSON", async () => {
    const { handler, seen } = setup(createFixtureGateway(fixtures.complete));
    const out = sink();
    await handler(event("/summaries", "POST", { title: "" }), out.stream, context);

    expect(seen.prelude).toMatchObject({
      statusCode: 400,
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(Buffer.concat(out.chunks).toString("utf8"))).toMatchObject({
      error: { code: "invalid_request" },
    });
  });

  it("aborts the model when writing to the response stream fails", async () => {
    const seenByModel: { signal?: AbortSignal } = {};
    const { handler } = setup({
      converseStream: (_request, signal) => {
        seenByModel.signal = signal;
        return Promise.resolve(
          (async function* () {
            yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "first" } } };
            yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "second" } } };
            await untilAborted(signal);
          })(),
        );
      },
    });
    await expect(
      handler(event("/summaries", "POST", NOTE), sink(1).stream, context),
    ).rejects.toThrow("the caller is gone");
    await expect.poll(() => seenByModel.signal?.aborted).toBe(true);
  });
});

describe("the SSE frame", () => {
  it("is the event name, the data, and a blank line", () => {
    expect(sseFrame("delta", '{"type":"delta","text":"a"}')).toBe(
      'event: delta\ndata: {"type":"delta","text":"a"}\n\n',
    );
  });

  it("gives every line of the data its own field, so a line break cannot end the event", () => {
    expect(sseFrame("x", "a\nb\r\nc")).toBe("event: x\ndata: a\ndata: b\ndata: c\n\n");
  });
});
