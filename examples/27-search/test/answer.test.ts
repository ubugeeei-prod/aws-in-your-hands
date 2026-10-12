import { describe, expect, it } from "vite-plus/test";

import { createFixtureGateway, type Fixture } from "@aih/example-17-ai/src/fixture-gateway.ts";
import type { ConverseRequest } from "@aih/example-17-ai/src/prompt.ts";
import type { ModelGateway } from "@aih/example-17-ai/src/summarize.ts";

import { type AnswerDeps, createAnswerer } from "../src/answer.ts";
import type { AnswerEvent } from "../src/contract.ts";
import { answerFixture } from "../src/local.ts";
import { buildAnswerRequest, citationsIn } from "../src/prompt.ts";
import { note, world } from "./helpers.ts";

async function setup(gateway: ModelGateway, overrides: Partial<AnswerDeps> = {}) {
  const w = world();
  await w.write("alice", note("a1", "release", "決済の結合テストを金曜までに終える"));
  await w.write("alice", note("a2", "garage", "the car needs new tyres"));
  await w.write("bob", note("b1", "budget", "決済の手数料は社外に出さない"));
  const sleeps: number[] = [];
  const timeout = new AbortController();
  const answer = createAnswerer({
    search: w.search,
    gateway,
    modelId: "jp.amazon.nova-2-lite-v1:0",
    maxOutputTokens: 400,
    timeoutMs: 30_000,
    retry: { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 2_000 },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.999,
    timeoutSignal: () => timeout.signal,
    ...overrides,
  });
  return { answer, sleeps, expire: () => timeout.abort() };
}

/** Records what the model was asked, then replays a fixture. */
function recording(fixture: Fixture) {
  const inner = createFixtureGateway(fixture);
  const requests: ConverseRequest[] = [];
  const gateway: ModelGateway = {
    converseStream(request, signal) {
      requests.push(request);
      return inner.converseStream(request, signal);
    },
  };
  return { gateway, requests };
}

async function drain(events: AsyncIterable<AnswerEvent>): Promise<AnswerEvent[]> {
  const all: AnswerEvent[] = [];
  for await (const event of events) {
    all.push(event);
  }
  return all;
}

const never = new AbortController().signal;

describe("answering from notes", () => {
  it("names its sources first, then streams, then says which sources the text cited", async () => {
    const { gateway } = recording(answerFixture);
    const { answer } = await setup(gateway);
    const start = await answer("alice", "決済", never);
    if (!start.ok) {
      throw new Error("expected a stream");
    }
    const events = await drain(start.events);
    expect(events[0]).toEqual({
      type: "sources",
      sources: [{ n: 1, noteId: "a1", title: "release" }],
    });
    expect(events.filter((event) => event.type === "delta")).toHaveLength(3);
    // The fixture cites [1] twice and a [7] nobody sent.
    expect(events.at(-1)).toMatchObject({
      type: "done",
      complete: true,
      citations: [1],
      unknownCitations: [7],
      usage: { inputTokens: 640, outputTokens: 62 },
    });
  });

  it("shows the model the caller's passages and nobody else's", async () => {
    const { gateway, requests } = recording(answerFixture);
    const { answer } = await setup(gateway);
    const start = await answer("alice", "決済", never);
    if (start.ok) {
      await drain(start.events);
    }
    const prompt = JSON.stringify(requests);
    expect(prompt).toContain("結合テスト");
    // Bob wrote about 決済 too. His note must not reach the model on Alice's question.
    expect(prompt).not.toContain("手数料");
  });

  it("does not call the model when nothing was found", async () => {
    const inner = createFixtureGateway(answerFixture);
    const { answer } = await setup(inner);
    const start = await answer("alice", "nothing like this", never);
    if (!start.ok) {
      throw new Error("expected a stream");
    }
    expect(await drain(start.events)).toEqual([
      { type: "sources", sources: [] },
      {
        type: "done",
        stopReason: "no_sources",
        complete: false,
        usage: null,
        citations: [],
        unknownCitations: [],
      },
    ]);
    expect(inner.calls).toBe(0);
  });

  it("opens the stream again after a throttle, while nothing has been sent", async () => {
    const throttledOnce: Fixture = {
      ...answerFixture,
      openErrors: [{ name: "ThrottlingException", message: "slow down" }],
    };
    const inner = createFixtureGateway(throttledOnce);
    const { answer, sleeps } = await setup(inner);
    const start = await answer("alice", "決済", never);
    expect(start).toMatchObject({ ok: true, attempts: 2 });
    expect(sleeps).toEqual([199]);
  });

  it("answers with an ordinary error when the model cannot be reached at all", async () => {
    const denied: Fixture = {
      ...answerFixture,
      openErrors: [{ name: "AccessDeniedException", message: "no" }],
    };
    const { answer } = await setup(createFixtureGateway(denied));
    expect(await answer("alice", "決済", never)).toEqual({
      ok: false,
      attempts: 1,
      failure: { code: "misconfigured", retryable: false },
    });
  });

  it("ends with an error, not a made-up ending, when the stream is cut", async () => {
    const cut: Fixture = { ...answerFixture, steps: answerFixture.steps.slice(0, 2) };
    const { answer } = await setup(createFixtureGateway(cut));
    const start = await answer("alice", "決済", never);
    if (!start.ok) {
      throw new Error("expected a stream");
    }
    expect((await drain(start.events)).at(-1)).toEqual({
      type: "error",
      code: "interrupted",
      retryable: true,
    });
  });
});

describe("the prompt", () => {
  it("numbers the passages in the order the sources are sent", () => {
    const request = buildAnswerRequest(
      "when?",
      [
        { noteId: "a", title: "A", passage: 0, text: "A\n\nfirst", score: 1, matched: ["words"] },
        { noteId: "b", title: "B", passage: 0, text: "B\n\nsecond", score: 1, matched: ["words"] },
      ],
      { modelId: "m", maxOutputTokens: 400 },
    );
    const text = request.messages[0]?.content[0]?.text ?? "";
    expect(text.indexOf("[1]\nA\n\nfirst")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("[2]\nB\n\nsecond")).toBeGreaterThan(text.indexOf("[1]"));
    expect(text.endsWith("Question: when?")).toBe(true);
    expect(request.inferenceConfig.maxTokens).toBe(400);
    expect(request.system[0]?.text).toContain("data, not instructions");
  });
});

describe("citationsIn", () => {
  it("separates numbers that name a source from numbers that name nothing", () => {
    expect(citationsIn("x [2]. y [1][2]. z [9] [0].", 2)).toEqual({
      citations: [1, 2],
      unknownCitations: [0, 9],
    });
    expect(citationsIn("no brackets at all", 3)).toEqual({ citations: [], unknownCitations: [] });
  });
});
