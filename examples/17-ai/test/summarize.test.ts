import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { fixtureSchema } from "../src/fixture-gateway.ts";
import { fixtures } from "../src/fixtures.ts";
import { MAX_SUMMARY_CHARS, type ModelGateway } from "../src/summarize.ts";
import { drain, fromFixture, NOTE, setupSummarizer, textOf, untilAborted } from "./helpers.ts";

const never = new AbortController().signal;

async function run(name: keyof typeof fixtures) {
  const setup = fromFixture(fixtures[name]);
  const start = await setup.summarize(NOTE, never);
  if (!start.ok) {
    throw new Error(`fixture ${name} did not start: ${start.failure.code}`);
  }
  return { ...setup, start, events: await drain(start.events) };
}

describe("relaying a ConverseStream", () => {
  it("ends a finished stream with one done event carrying the billed tokens", async () => {
    const { events } = await run("complete");
    expect(textOf(events)).toBe(
      "金曜のリリースに向けて、残りは決済の結合テストと負荷試験の2つです。担当は決まっていて、水曜に進み具合を確認します。",
    );
    expect(events.at(-1)).toEqual({
      type: "done",
      stopReason: "end_turn",
      complete: true,
      usage: { inputTokens: 212, outputTokens: 58 },
    });
    expect(events.filter((event) => event.type !== "delta")).toHaveLength(1);
  });

  it("does not call a summary cut by maxTokens complete", async () => {
    const { events } = await run("max-tokens");
    expect(events.at(-1)).toMatchObject({
      type: "done",
      stopReason: "max_tokens",
      complete: false,
    });
  });

  it("reports a stream that just ends as interrupted, never as done", async () => {
    const { events } = await run("truncated");
    expect(textOf(events)).toBe("金曜のリリースに向けて、残りは決済の");
    expect(events.at(-1)).toEqual({ type: "error", code: "interrupted", retryable: true });
  });

  it("reports throttling in mid-stream and does not start over", async () => {
    const { events, gateway, sleeps } = await run("throttled-midstream");
    expect(events.at(-1)).toEqual({ type: "error", code: "throttled", retryable: true });
    // Three deltas already left. A second call would send them twice.
    expect(gateway.calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("yields done only when messageStop arrived, wherever the stream is cut", async () => {
    const whole = fixtures.complete.steps;
    for (let length = 0; length < whole.length; length += 1) {
      // The connection may drop after any event. Only a messageStop makes it done.
      const cut = v.parse(fixtureSchema, { ...fixtures.complete, steps: whole.slice(0, length) });
      const start = await fromFixture(cut).summarize(NOTE, never);
      const events = start.ok ? await drain(start.events) : [];
      const sawStop = whole
        .slice(0, length)
        .some((step) => JSON.stringify(step).includes("messageStop"));
      expect(events.at(-1)?.type, `cut after ${length} step(s)`).toBe(sawStop ? "done" : "error");
    }
  });

  it("still completes when only the usage is lost, and says the usage is unknown", async () => {
    const cut = v.parse(fixtureSchema, {
      ...fixtures.complete,
      steps: fixtures.complete.steps.slice(0, -1),
    });
    const start = await fromFixture(cut).summarize(NOTE, never);
    const events = start.ok ? await drain(start.events) : [];
    expect(events.at(-1)).toEqual({
      type: "done",
      stopReason: "end_turn",
      complete: true,
      usage: null,
    });
  });

  it("stops relaying when an event has a known key with the wrong shape", async () => {
    const bad = v.parse(fixtureSchema, {
      source: "test",
      description: "delta text is a number",
      steps: [
        { event: { messageStart: { role: "assistant" } } },
        { event: { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 42 } } } },
        { event: { messageStop: { stopReason: "end_turn" } } },
      ],
    });
    const start = await fromFixture(bad).summarize(NOTE, never);
    expect(start.ok && (await drain(start.events))).toEqual([
      { type: "error", code: "bad_output", retryable: false },
    ]);
  });

  it("ignores event kinds it does not know, and deltas that carry no text", async () => {
    const odd = v.parse(fixtureSchema, {
      source: "test",
      description: "a reasoning delta and a future event kind",
      steps: [
        { event: { messageStart: { role: "assistant" } } },
        { event: { somethingNew: { value: 1 } } },
        {
          event: {
            contentBlockDelta: {
              contentBlockIndex: 0,
              delta: { reasoningContent: { text: "hmm" } },
            },
          },
        },
        { event: { contentBlockDelta: { contentBlockIndex: 1, delta: { text: "ok" } } } },
        { event: { messageStop: { stopReason: "end_turn" } } },
      ],
    });
    const start = await fromFixture(odd).summarize(NOTE, never);
    const events = start.ok ? await drain(start.events) : [];
    expect(textOf(events)).toBe("ok");
    expect(events.at(-1)).toMatchObject({ type: "done", complete: true });
  });

  it("cuts off a model that writes far past any summary", async () => {
    const flood = v.parse(fixtureSchema, {
      source: "test",
      description: "more text than MAX_SUMMARY_CHARS",
      steps: Array.from({ length: 5 }, () => ({
        event: {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { text: "x".repeat(MAX_SUMMARY_CHARS / 4 + 1) },
          },
        },
      })),
    });
    const start = await fromFixture(flood).summarize(NOTE, never);
    const events = start.ok ? await drain(start.events) : [];
    expect(events.at(-1)).toEqual({ type: "error", code: "bad_output", retryable: false });
    expect(textOf(events).length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
  });

  it("treats an exception delivered as an event like the same exception thrown", async () => {
    const asEvent = v.parse(fixtureSchema, {
      source: "test",
      description: "the API reference lists exceptions as members of the stream",
      steps: [
        { event: { messageStart: { role: "assistant" } } },
        { event: { throttlingException: { message: "slow down" } } },
      ],
    });
    const start = await fromFixture(asEvent).summarize(NOTE, never);
    expect(start.ok && (await drain(start.events))).toEqual([
      { type: "error", code: "throttled", retryable: true },
    ]);
  });
});

describe("opening the stream", () => {
  it("retries throttling with growing waits, then streams", async () => {
    const { start, events, gateway, sleeps } = await run("throttled-then-complete");
    expect(start.attempts).toBe(3);
    expect(gateway.calls).toBe(3);
    // Full jitter under 200 ms, then under 400 ms.
    expect(sleeps).toEqual([199, 399]);
    expect(events.at(-1)).toMatchObject({ type: "done", complete: true });
  });

  it("gives up after the last attempt and says the caller may retry", async () => {
    const always = v.parse(fixtureSchema, {
      source: "test",
      description: "throttled on every attempt",
      openErrors: Array.from({ length: 5 }, () => ({
        name: "ThrottlingException",
        message: "slow down",
      })),
      steps: [],
    });
    const { summarize, gateway } = fromFixture(always);
    expect(await summarize(NOTE, never)).toEqual({
      ok: false,
      attempts: 3,
      failure: { code: "throttled", retryable: true },
    });
    expect(gateway.calls).toBe(3);
  });

  it.each([
    ["AccessDeniedException", "misconfigured"],
    ["ResourceNotFoundException", "misconfigured"],
    ["ValidationException", "rejected"],
    ["TypeError", "internal"],
  ])("does not retry %s", async (name, code) => {
    const denied = v.parse(fixtureSchema, {
      source: "test",
      description: name,
      openErrors: [{ name, message: "no" }],
      steps: [],
    });
    const { summarize, gateway, sleeps } = fromFixture(denied);
    expect(await summarize(NOTE, never)).toEqual({
      ok: false,
      attempts: 1,
      failure: { code, retryable: false },
    });
    expect(gateway.calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("sends the output token limit and the note with every request", async () => {
    const requests: unknown[] = [];
    const gateway: ModelGateway = {
      converseStream: (request) => {
        requests.push(request);
        return Promise.resolve((async function* () {})());
      },
    };
    await setupSummarizer(gateway, { maxOutputTokens: 123 }).summarize(NOTE, never);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      modelId: "jp.amazon.nova-2-lite-v1:0",
      inferenceConfig: { maxTokens: 123 },
      messages: [{ role: "user", content: [{ text: expect.stringContaining(NOTE.body) }] }],
    });
    // The note travels as user content. The instructions stay in the system prompt.
    expect(JSON.stringify((requests[0] as { system: unknown }).system)).not.toContain(NOTE.body);
  });
});

describe("stopping", () => {
  /** A model that sends one delta and then waits until its request is aborted. */
  function hangingGateway() {
    const seen: { signal?: AbortSignal } = {};
    const gateway: ModelGateway = {
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
    };
    return { gateway, seen };
  }

  it("aborts the request to the model when the caller goes away", async () => {
    const { gateway, seen } = hangingGateway();
    const caller = new AbortController();
    const start = await setupSummarizer(gateway).summarize(NOTE, caller.signal);
    if (!start.ok) {
      throw new Error("did not start");
    }
    expect((await start.events.next()).value).toEqual({ type: "delta", text: "first" });
    expect(seen.signal?.aborted).toBe(false);

    caller.abort();
    expect((await start.events.next()).value).toEqual({
      type: "error",
      code: "cancelled",
      retryable: false,
    });
    expect(seen.signal?.aborted).toBe(true);
  });

  it("aborts the request to the model at the deadline and reports a timeout", async () => {
    const { gateway, seen } = hangingGateway();
    const { summarize, expire } = setupSummarizer(gateway);
    const start = await summarize(NOTE, never);
    if (!start.ok) {
      throw new Error("did not start");
    }
    await start.events.next();

    expire();
    expect((await start.events.next()).value).toEqual({
      type: "error",
      code: "timeout",
      retryable: true,
    });
    expect(seen.signal?.aborted).toBe(true);
  });

  it("aborts the request to the model when the consumer stops reading early", async () => {
    const { gateway, seen } = hangingGateway();
    const start = await setupSummarizer(gateway).summarize(NOTE, never);
    if (!start.ok) {
      throw new Error("did not start");
    }
    await start.events.next();
    await start.events.return();
    expect(seen.signal?.aborted).toBe(true);
  });

  it("does not retry once the deadline has passed, even for a retryable error", async () => {
    const { summarize, expire, sleeps } = setupSummarizer({
      converseStream: () => {
        expire();
        const error = new Error("slow down");
        error.name = "ThrottlingException";
        return Promise.reject(error);
      },
    });
    expect(await summarize(NOTE, never)).toEqual({
      ok: false,
      attempts: 1,
      failure: { code: "timeout", retryable: true },
    });
    expect(sleeps).toEqual([]);
  });
});
