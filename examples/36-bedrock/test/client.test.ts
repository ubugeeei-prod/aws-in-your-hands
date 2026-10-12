import { describe, expect, it } from "vite-plus/test";

import { sseFrame } from "@aih/example-17-ai/src/sse.ts";

import { assistantEvents, collectAnswer } from "../src/client.ts";
import type { AssistantEvent } from "../src/contract.ts";
import { NO_USAGE } from "../src/usage.ts";

const body = (events: unknown[]): ReadableStream<Uint8Array> =>
  new Response(events.map((event) => sseFrame("e", JSON.stringify(event))).join("")).body ??
  new ReadableStream();

const done = (complete: boolean, stopReason = "end_turn"): AssistantEvent => ({
  type: "done",
  stopReason,
  complete,
  turns: 1,
  usage: NO_USAGE,
});

describe("collectAnswer", () => {
  it("calls the text an answer only after a `done` that says complete", async () => {
    const whole = await collectAnswer(
      assistantEvents(body([{ type: "delta", text: "はい。" }, done(true)])),
    );
    expect(whole).toMatchObject({ status: "complete", text: "はい。" });

    const stopped = await collectAnswer(
      assistantEvents(body([{ type: "delta", text: "は" }, done(false, "turn_limit")])),
    );
    expect(stopped).toEqual({
      status: "incomplete",
      partial: "は",
      reason: "turn_limit",
      retryable: false,
    });

    const cut = await collectAnswer(assistantEvents(body([{ type: "delta", text: "は" }])));
    expect(cut).toEqual({
      status: "incomplete",
      partial: "は",
      reason: "interrupted",
      retryable: true,
    });
  });

  it("replaces what was shown with the guardrail's message", async () => {
    const answer = await collectAnswer(
      assistantEvents(
        body([
          { type: "delta", text: "鍵は AKIA" },
          { type: "blocked", text: "この回答は表示できません。" },
          done(false, "guardrail_intervened"),
        ]),
      ),
    );
    expect(answer).toEqual({
      status: "blocked",
      text: "この回答は表示できません。",
      usage: NO_USAGE,
    });
  });

  it("stops at an event that does not fit the contract, and reads nothing after it", async () => {
    const answer = await collectAnswer(
      assistantEvents(body([{ type: "delta", text: "a" }, { type: "surprise" }, done(true)])),
    );
    expect(answer).toMatchObject({ status: "incomplete", partial: "a" });
  });
});
