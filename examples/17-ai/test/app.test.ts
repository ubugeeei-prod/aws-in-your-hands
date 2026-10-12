import { describe, expect, it } from "vite-plus/test";

import type { LogEntry } from "@aih/example-04-http-api/src/log.ts";

import { createApp } from "../src/app.ts";
import { collectSummary, summaryEvents } from "../src/client.ts";
import { errorSchema, healthSchema, MAX_BODY_CHARS } from "../src/contract.ts";
import { createFixtureGateway, type Fixture, fixtureSchema } from "../src/fixture-gateway.ts";
import { fixtures } from "../src/fixtures.ts";
import type { ModelGateway } from "../src/summarize.ts";
import { NOTE, setupSummarizer, untilAborted } from "./helpers.ts";

function setup(gateway: ModelGateway) {
  let requestId = 0;
  let clock = 0;
  const logs: LogEntry[] = [];
  const summarizer = setupSummarizer(gateway);
  const app = createApp({
    env: {
      AI_BACKEND: "fixture",
      BEDROCK_MODEL_ID: "jp.amazon.nova-2-lite-v1:0",
      AWS_REGION: "ap-northeast-1",
      MAX_OUTPUT_TOKENS: 400,
      INFERENCE_TIMEOUT_MS: 30_000,
      LOG_LEVEL: "debug",
      STAGE: "test",
    },
    summarize: summarizer.summarize,
    log: (entry) => logs.push(entry),
    newRequestId: () => `req-${++requestId}`,
    now: () => (clock += 5),
  });
  const post = (body: unknown, init: RequestInit = {}) =>
    app.request("/summaries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
      ...init,
    });
  return { app, logs, post, ...summarizer };
}

const withFixture = (fixture: Fixture) => {
  const gateway = createFixtureGateway(fixture);
  return { gateway, ...setup(gateway) };
};

async function body(response: Response): Promise<ReadableStream<Uint8Array>> {
  if (response.body === null) {
    throw new Error("the response has no body");
  }
  return response.body;
}

describe("POST /summaries", () => {
  it("streams a summary as server-sent events and logs what it cost", async () => {
    const { post, logs } = withFixture(fixtures.complete);
    const response = await post(NOTE);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-request-id")).toBe("req-1");

    const result = await collectSummary(summaryEvents(await body(response)));
    expect(result).toMatchObject({
      status: "complete",
      usage: { inputTokens: 212, outputTokens: 58 },
    });
    expect(logs).toContainEqual(
      expect.objectContaining({
        message: "summary",
        requestId: "req-1",
        outcome: "complete",
        attempts: 1,
        usage: { inputTokens: 212, outputTokens: 58 },
      }),
    );
  });

  it("answers a failure before the first event as an ordinary HTTP error", async () => {
    const throttled = fixtureSchema.parse({
      source: "test",
      description: "throttled on every attempt",
      openErrors: Array.from({ length: 3 }, () => ({
        name: "ThrottlingException",
        message: "slow down",
      })),
      steps: [],
    });
    const { post, logs } = withFixture(throttled);
    const response = await post(NOTE);

    expect(response.status).toBe(429);
    expect(errorSchema.parse(await response.json()).error).toMatchObject({
      code: "throttled",
      retryable: true,
    });
    expect(logs).toContainEqual(
      expect.objectContaining({ message: "summary", outcome: "throttled", attempts: 3 }),
    );
  });

  it("does not tell the caller why the model refused the function's role", async () => {
    const denied = fixtureSchema.parse({
      source: "test",
      description: "the role lacks permission",
      openErrors: [
        {
          name: "AccessDeniedException",
          message: "role arn:aws:iam::111122223333:role/x is not authorized",
        },
      ],
      steps: [],
    });
    const response = await withFixture(denied).post(NOTE);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("111122223333");
    expect(errorSchema.parse(JSON.parse(text)).error.code).toBe("misconfigured");
  });

  it("ends a stream that failed midway with an error event, after the text that did arrive", async () => {
    const { post, logs } = withFixture(fixtures["throttled-midstream"]);
    const result = await collectSummary(summaryEvents(await body(await post(NOTE))));

    expect(result).toEqual({
      status: "incomplete",
      partial: "金曜のリリースに向けて、残りは決済の",
      reason: "throttled",
      retryable: true,
    });
    expect(logs).toContainEqual(
      expect.objectContaining({ message: "summary", outcome: "throttled", usage: null }),
    );
  });

  it("never calls the model for a note that breaks the limits", async () => {
    const { post, gateway } = withFixture(fixtures.complete);
    const cases = [
      { title: "t", body: "x".repeat(MAX_BODY_CHARS + 1) },
      { title: "", body: "x" },
      { title: "t", body: "   " },
      { title: "t" },
    ];
    for (const invalid of cases) {
      const response = await post(invalid);
      expect(response.status).toBe(400);
      expect(errorSchema.parse(await response.json()).error.code).toBe("invalid_request");
    }
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ title: "t", body: "x".repeat(70_000) })).status).toBe(413);
    expect(gateway.calls).toBe(0);
  });

  it("aborts the model when the caller stops reading the response", async () => {
    const seen: { signal?: AbortSignal } = {};
    const { post, logs } = setup({
      converseStream: (_request, signal) => {
        seen.signal = signal;
        return Promise.resolve(
          (async function* () {
            yield { messageStart: { role: "assistant" } };
            yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "first" } } };
            await untilAborted(signal);
          })(),
        );
      },
    });
    const reader = (await body(await post(NOTE))).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("first");
    expect(seen.signal?.aborted).toBe(false);

    await reader.cancel();
    await expect.poll(() => seen.signal?.aborted).toBe(true);
    await expect
      .poll(() => logs)
      .toContainEqual(expect.objectContaining({ message: "summary", outcome: "cancelled" }));
  });

  it("aborts the model when the request itself is aborted", async () => {
    const seen: { signal?: AbortSignal } = {};
    const caller = new AbortController();
    const { post } = setup({
      converseStream: (_request, signal) => {
        seen.signal = signal;
        return untilAborted(signal);
      },
    });
    const pending = post(NOTE, { signal: caller.signal });
    await expect.poll(() => seen.signal !== undefined).toBe(true);
    caller.abort();

    expect((await pending).status).toBe(503);
    expect(seen.signal?.aborted).toBe(true);
  });
});

describe("the rest of the API", () => {
  it("says which backend answers, so a billed one is never a surprise", async () => {
    const { app } = withFixture(fixtures.complete);
    expect(healthSchema.parse(await (await app.request("/health")).json())).toEqual({
      status: "ok",
      stage: "test",
      backend: "fixture",
      modelId: "jp.amazon.nova-2-lite-v1:0",
    });
  });

  it("answers 404 with the error shape for an unknown route", async () => {
    const response = await withFixture(fixtures.complete).app.request("/nope");
    expect(response.status).toBe(404);
    expect(errorSchema.parse(await response.json()).error.code).toBe("not_found");
  });
});
