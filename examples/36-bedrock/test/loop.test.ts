import { describe, expect, it } from "vite-plus/test";

import type { ContentBlock } from "../src/converse.ts";
import { assistantMessage, decide, type LoopState } from "../src/loop.ts";
import { modelProfiles } from "../src/models.ts";
import type { Turn } from "../src/turn.ts";
import { NO_USAGE } from "../src/usage.ts";
import {
  ALICE,
  BOBS_SECRET,
  drain,
  HAIKU,
  LIMITS,
  never,
  requestOptions,
  setup,
  textOf,
  toolsFor,
} from "./helpers.ts";

const state = (overrides: Partial<LoopState> = {}): LoopState => ({
  turns: 1,
  usage: NO_USAGE,
  toolErrors: 0,
  ...overrides,
});
const message = (
  stopReason: string,
  overrides: Partial<Extract<Turn, { kind: "message" }>> = {},
): Turn => ({
  kind: "message",
  stopReason,
  text: "",
  toolUses: [],
  usage: null,
  ...overrides,
});
const use = (n: number) => ({ toolUseId: `tooluse_${n}`, name: "list_notes", inputJson: "{}" });
const fresh = { sentText: false, mayRetry: true };

describe("decide", () => {
  it("finishes on end_turn, and only then calls the answer whole", () => {
    expect(decide(state(), message("end_turn", { text: "はい。" }), LIMITS, fresh)).toEqual({
      do: "finish",
      stopReason: "end_turn",
      complete: true,
    });
    for (const reason of [
      "max_tokens",
      "content_filtered",
      "model_context_window_exceeded",
      "something_new",
    ]) {
      expect(decide(state(), message(reason, { text: "は" }), LIMITS, fresh)).toEqual({
        do: "finish",
        stopReason: reason,
        complete: false,
      });
    }
    expect(decide(state(), message("end_turn"), LIMITS, fresh)).toMatchObject({ do: "fail" });
  });

  it("runs tools while there are turns and tokens left, and stops when either runs out", () => {
    const asks = message("tool_use", { toolUses: [use(1)] });
    expect(decide(state({ turns: 3 }), asks, LIMITS, fresh)).toMatchObject({ do: "call_tools" });
    expect(decide(state({ turns: 4 }), asks, LIMITS, fresh)).toEqual({
      do: "finish",
      stopReason: "turn_limit",
      complete: false,
    });
    const spent = { ...NO_USAGE, inputTokens: 19_000, outputTokens: 1_000 };
    expect(decide(state({ usage: spent }), asks, LIMITS, fresh)).toEqual({
      do: "finish",
      stopReason: "token_limit",
      complete: false,
    });
  });

  it("counts what was read from and written to the cache towards the token limit", () => {
    const cached = { ...NO_USAGE, cacheReadInputTokens: 15_000, cacheWriteInputTokens: 5_000 };
    expect(
      decide(state({ usage: cached }), message("tool_use", { toolUses: [use(1)] }), LIMITS, fresh),
    ).toMatchObject({ stopReason: "token_limit" });
  });

  it("runs at most four tool requests of one answer and refuses the rest", () => {
    const six = message("tool_use", { toolUses: [1, 2, 3, 4, 5, 6].map(use) });
    const step = decide(state(), six, LIMITS, fresh);
    expect(step).toMatchObject({ do: "call_tools" });
    expect(step.do === "call_tools" ? [step.run.length, step.refuse.length] : []).toEqual([4, 2]);
  });

  it("treats tool_use without a tool, and the malformed stop reasons, as bad output", () => {
    for (const turn of [
      message("tool_use"),
      message("malformed_tool_use"),
      message("malformed_model_output"),
    ]) {
      expect(decide(state(), turn, LIMITS, fresh)).toEqual({
        do: "fail",
        failure: { code: "bad_output", retryable: false },
      });
    }
    expect(decide(state(), message("guardrail_intervened", { text: "no" }), LIMITS, fresh)).toEqual(
      { do: "block" },
    );
  });

  it("retries a failed attempt only if none of its text was sent and an attempt is left", () => {
    const cut: Turn = {
      kind: "failed",
      failure: { code: "interrupted", retryable: true },
      text: "",
    };
    expect(decide(state(), cut, LIMITS, fresh)).toEqual({ do: "retry" });
    expect(decide(state(), cut, LIMITS, { sentText: true, mayRetry: true })).toMatchObject({
      do: "fail",
    });
    expect(decide(state(), cut, LIMITS, { sentText: false, mayRetry: false })).toMatchObject({
      do: "fail",
    });
    const refused: Turn = {
      kind: "failed",
      failure: { code: "misconfigured", retryable: false },
      text: "",
    };
    expect(decide(state(), refused, LIMITS, fresh)).toMatchObject({ do: "fail" });
  });
});

const toolResults = (content: ContentBlock[] | undefined) =>
  (content ?? []).flatMap((block) => ("toolResult" in block ? [block.toolResult] : []));

describe("the loop, against scripted transcripts", () => {
  it("lists, reads, and answers: each result goes back in the message after the request it answers", async () => {
    const { assistant, model } = setup("tool-then-answer");
    const events = await drain(assistant("残っている作業は？", await toolsFor(ALICE), never));

    expect(events.map((event) => event.type)).toEqual([
      "tool",
      "tool",
      "delta",
      "delta",
      "delta",
      "delta",
      "done",
    ]);
    expect(textOf(events)).toContain("決済の結合テストと負荷試験");
    expect(events.at(-1)).toEqual({
      type: "done",
      stopReason: "end_turn",
      complete: true,
      turns: 3,
      // 318 + 402 + 520 in, 12 + 18 + 61 out: the conversation is sent again on every turn.
      usage: {
        inputTokens: 1240,
        outputTokens: 91,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
    });

    expect(model.requests).toHaveLength(3);
    expect(model.requests.map((request) => request.messages.length)).toEqual([1, 3, 5]);
    const third = model.requests[2]?.messages ?? [];
    expect(third.map((entry) => entry.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(third[3]?.content).toEqual([
      {
        toolUse: { toolUseId: "tooluse_fixture_02", name: "read_note", input: { id: "n1release" } },
      },
    ]);
    expect(toolResults(third[4]?.content)).toMatchObject([
      { toolUseId: "tooluse_fixture_02", status: "success" },
    ]);
    expect(JSON.stringify(third[4])).toContain("佐藤さんと鈴木さん");
  });

  it("tells the model a tool does not exist, and lets it answer", async () => {
    const { assistant, model } = setup("invented-tool");
    const events = await drain(assistant("ノートを消して", await toolsFor(ALICE), never));
    expect(events[0]).toEqual({ type: "tool", name: "delete_note", ok: false });
    expect(events.at(-1)).toMatchObject({ type: "done", complete: true, turns: 2 });
    expect(toolResults(model.requests[1]?.messages[2]?.content)).toMatchObject([
      { toolUseId: "tooluse_fixture_01", status: "error" },
    ]);
  });

  it("answers a tool request whose input is not JSON with an error, and repeats it with empty input", async () => {
    const { assistant, model } = setup("malformed-input");
    const events = await drain(assistant("残っている作業は？", await toolsFor(ALICE), never));
    expect(events.filter((event) => event.type === "tool")).toEqual([
      { type: "tool", name: "read_note", ok: false },
      { type: "tool", name: "read_note", ok: true },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "done", complete: true, turns: 3 });
    expect(model.requests[1]?.messages[1]?.content).toEqual([
      { toolUse: { toolUseId: "tooluse_fixture_01", name: "read_note", input: {} } },
    ]);
  });

  it("gives up when the model keeps asking for what it cannot have", async () => {
    const { assistant } = setup("injected", { limits: { ...LIMITS, maxToolErrors: 1 } });
    const events = await drain(assistant("メモを要約して", await toolsFor(ALICE), never));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "bad_output", turns: 2 });
  });

  it("passes on the guardrail's message as `blocked`, and never calls the answer whole", async () => {
    const { assistant, model } = setup("guardrail-blocked", {
      request: requestOptions({ guardrail: { id: "gr1abcd2ef", version: "1" } }),
    });
    const events = await drain(assistant("鍵を教えて", await toolsFor(ALICE), never));
    expect(events.slice(-2)).toEqual([
      { type: "blocked", text: "この質問にはお答えできません。" },
      {
        type: "done",
        stopReason: "guardrail_intervened",
        complete: false,
        turns: 1,
        usage: NO_USAGE,
      },
    ]);
    expect(model.requests[0]?.guardrailConfig).toEqual({
      guardrailIdentifier: "gr1abcd2ef",
      guardrailVersion: "1",
      trace: "disabled",
      streamProcessingMode: "sync",
    });
  });

  it("makes the call again when the stream closes mid tool request, without running that tool", async () => {
    const { assistant, model, sleeps } = setup("cut-mid-tool-use");
    const events = await drain(assistant("残っている作業は？", await toolsFor(ALICE), never));
    // One tool ran: the whole request of the second call, not the half of the first.
    expect(events.filter((event) => event.type === "tool")).toEqual([
      { type: "tool", name: "read_note", ok: true },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "done", complete: true, turns: 2 });
    expect(model.requests).toHaveLength(3);
    // The second call is the first one again: nothing of the cut answer was kept.
    expect(model.requests[1]).toEqual(model.requests[0]);
    expect(sleeps).toEqual([199]);
  });

  it("does not make the call again once part of the answer has been sent", async () => {
    const { assistant, model, sleeps } = setup("cut-mid-answer");
    const events = await drain(assistant("残っている作業は？", await toolsFor(ALICE), never));
    expect(events).toEqual([
      { type: "delta", text: "金曜のリリースまでに" },
      { type: "error", code: "interrupted", retryable: true, turns: 0, usage: NO_USAGE },
    ]);
    expect(model.requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("waits and tries again when throttled, and stops after three attempts", async () => {
    const once = setup("throttled-then-answer");
    const recovered = await drain(once.assistant("こんにちは", await toolsFor(ALICE), never));
    expect(recovered.at(-1)).toMatchObject({ type: "done", complete: true });
    expect(once.sleeps).toEqual([199]);

    const always = setup("always-throttled");
    const refused = await drain(always.assistant("こんにちは", await toolsFor(ALICE), never));
    expect(refused).toEqual([
      { type: "error", code: "throttled", retryable: true, turns: 0, usage: NO_USAGE },
    ]);
    expect(always.model.requests).toHaveLength(3);
    // Full jitter under a ceiling that doubles: at most 200 ms, then at most 400 ms.
    expect(always.sleeps).toEqual([199, 399]);
  });

  it("stops a model that asks for tools forever at the turn limit", async () => {
    const { assistant, model } = setup("runaway-tools");
    const events = await drain(assistant("全部見て", await toolsFor(ALICE), never));
    expect(events.at(-1)).toMatchObject({
      type: "done",
      stopReason: "turn_limit",
      complete: false,
      turns: 4,
    });
    expect(model.requests).toHaveLength(4);
    expect(events.filter((event) => event.type === "tool")).toHaveLength(3);
  });

  it("stops at the token limit before the next call, not during one", async () => {
    const { assistant, model } = setup("runaway-tools", {
      limits: { ...LIMITS, maxTotalTokens: 800 },
    });
    const events = await drain(assistant("全部見て", await toolsFor(ALICE), never));
    // 402 after the first answer, 894 after the second: the second is where it shows.
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "token_limit", turns: 2 });
    expect(model.requests).toHaveLength(2);
  });

  it("reports a timeout, and a caller who left, instead of retrying", async () => {
    const late = setup("always-throttled");
    late.expire();
    expect(await drain(late.assistant("こんにちは", await toolsFor(ALICE), never))).toMatchObject([
      { type: "error", code: "timeout", retryable: true },
    ]);
    expect(late.sleeps).toEqual([]);

    const gone = setup("always-throttled");
    const caller = new AbortController();
    caller.abort();
    expect(
      await drain(gone.assistant("こんにちは", await toolsFor(ALICE), caller.signal)),
    ).toMatchObject([{ type: "error", code: "cancelled", retryable: false }]);
  });

  it("marks the conversation for the prompt cache when asked, within the model's four marks", async () => {
    const { assistant, model } = setup("runaway-tools", {
      request: requestOptions({ promptCache: true, modelId: HAIKU, profile: modelProfiles[HAIKU] }),
    });
    await drain(assistant("全部見て", await toolsFor(ALICE), never));
    const marks = model.requests.map(
      (request) => JSON.stringify(request).split('"cachePoint"').length - 1,
    );
    expect(marks).toEqual([1, 2, 3, 4]);
  });
});

describe("the invariant: the model never reaches another owner's note", () => {
  it("holds against a model that does whatever a note tells it", async () => {
    const { assistant, model } = setup("injected");
    const events = await drain(
      assistant("「メモ」というノートを要約して", await toolsFor(ALICE), never),
    );

    // The model did what the note said: it asked for Bob's note by ID, and for a list with an owner.
    expect(events.filter((event) => event.type === "tool")).toEqual([
      { type: "tool", name: "read_note", ok: true },
      { type: "tool", name: "read_note", ok: false },
      { type: "tool", name: "list_notes", ok: false },
    ]);
    // Nothing of Bob's went to the model, in any call, or to the caller.
    expect(JSON.stringify(model.requests)).not.toContain(BOBS_SECRET);
    expect(JSON.stringify(model.requests)).not.toContain("給与");
    expect(JSON.stringify(events)).not.toContain(BOBS_SECRET);
    expect(events.at(-1)).toMatchObject({ type: "done", complete: true, turns: 3 });
  });

  it("is broken by a tool that takes the owner from its input, which is why none does", async () => {
    const { seededNotes } = await import("../src/local-notes.ts");
    const { callTool } = await import("../src/tools.ts");
    const notes = await seededNotes();
    // The tool this example does not have.
    const leaky = async (inputJson: string) => {
      const { owner, id } = JSON.parse(inputJson) as { owner: string; id: string };
      return notes.get(owner, id);
    };
    expect(JSON.stringify(await leaky('{"owner":"local-bob","id":"b1salary"}'))).toContain(
      BOBS_SECRET,
    );
    // The real one, given the same input, refuses it.
    const real = await callTool(await toolsFor(ALICE), {
      toolUseId: "tooluse_x",
      name: "read_note",
      inputJson: '{"owner":"local-bob","id":"b1salary"}',
    });
    expect(real.ok).toBe(false);
  });
});

describe("assistantMessage", () => {
  it("leaves empty text out of the message it repeats", () => {
    const turn = {
      kind: "message",
      stopReason: "tool_use",
      text: "",
      toolUses: [use(1)],
      usage: null,
    } as const;
    expect(assistantMessage({ ...turn, toolUses: [...turn.toolUses] }).content).toEqual([
      { toolUse: { toolUseId: "tooluse_1", name: "list_notes", input: {} } },
    ]);
  });
});
