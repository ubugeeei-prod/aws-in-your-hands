import { describe, expect, it } from "vite-plus/test";

import { MAX_TURN_CHARS, readTurn, type Turn } from "../src/turn.ts";

async function* from(events: unknown[], failWith?: Error) {
  for (const event of events) {
    yield event;
  }
  if (failWith !== undefined) {
    throw failWith;
  }
}

async function read(events: unknown[], failWith?: Error): Promise<{ texts: string[]; turn: Turn }> {
  const reader = readTurn(from(events, failWith), () => undefined);
  const texts: string[] = [];
  for (;;) {
    const next = await reader.next();
    if (next.done === true) {
      return { texts, turn: next.value };
    }
    texts.push(next.value);
  }
}

const toolStart = (index: number, toolUseId: string, name: string) => ({
  contentBlockStart: { contentBlockIndex: index, start: { toolUse: { toolUseId, name } } },
});
const toolInput = (index: number, input: string) => ({
  contentBlockDelta: { contentBlockIndex: index, delta: { toolUse: { input } } },
});

describe("readTurn", () => {
  it("puts a tool request together from its pieces, and returns it only after messageStop", async () => {
    const { texts, turn } = await read([
      { messageStart: { role: "assistant" } },
      { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "ノートを見ます。" } } },
      toolStart(1, "tooluse_a", "read_note"),
      toolInput(1, '{"id":'),
      toolStart(2, "tooluse_b", "list_notes"),
      toolInput(1, '"n1release"}'),
      { messageStop: { stopReason: "tool_use" } },
      { metadata: { usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } } },
    ]);
    expect(texts).toEqual(["ノートを見ます。"]);
    expect(turn).toEqual({
      kind: "message",
      stopReason: "tool_use",
      text: "ノートを見ます。",
      toolUses: [
        { toolUseId: "tooluse_a", name: "read_note", inputJson: '{"id":"n1release"}' },
        { toolUseId: "tooluse_b", name: "list_notes", inputJson: "" },
      ],
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
    });
  });

  it("hands back no tool request from a stream that closed in the middle of one", async () => {
    const { turn } = await read([
      { messageStart: { role: "assistant" } },
      toolStart(0, "tooluse_a", "read_note"),
      toolInput(0, '{"id":"n1r'),
    ]);
    expect(turn).toEqual({
      kind: "failed",
      failure: { code: "interrupted", retryable: true },
      text: "",
    });
  });

  it("reads the cache counters when the call used the prompt cache", async () => {
    const { turn } = await read([
      { messageStop: { stopReason: "end_turn" } },
      {
        metadata: {
          usage: {
            inputTokens: 40,
            outputTokens: 9,
            cacheReadInputTokens: 1200,
            cacheWriteInputTokens: 300,
          },
        },
      },
    ]);
    expect(turn).toMatchObject({
      usage: {
        inputTokens: 40,
        outputTokens: 9,
        cacheReadInputTokens: 1200,
        cacheWriteInputTokens: 300,
      },
    });
  });

  it("turns an exception event and a thrown error into the failure they name", async () => {
    const asEvent = await read([{ throttlingException: { message: "slow down" } }]);
    expect(asEvent.turn).toMatchObject({ kind: "failed", failure: { code: "throttled" } });

    const error = new Error("capacity");
    error.name = "ServiceUnavailableException";
    const thrown = await read([{ messageStart: { role: "assistant" } }], error);
    expect(thrown.turn).toMatchObject({ kind: "failed", failure: { code: "unavailable" } });
  });

  it("refuses an event whose listed key has the wrong shape, and input for a tool that never started", async () => {
    const wrong = await read([{ messageStop: { stopReason: 7 } }]);
    expect(wrong.turn).toMatchObject({ kind: "failed", failure: { code: "bad_output" } });
    const orphan = await read([toolInput(3, "{}")]);
    expect(orphan.turn).toMatchObject({ kind: "failed", failure: { code: "bad_output" } });
  });

  it("stops reading an answer that will not end", async () => {
    const piece = "x".repeat(1000);
    const events = Array.from({ length: MAX_TURN_CHARS / 1000 + 1 }, () => toolInput(0, piece));
    const { turn } = await read([toolStart(0, "tooluse_a", "read_note"), ...events]);
    expect(turn).toMatchObject({
      kind: "failed",
      failure: { code: "bad_output", retryable: false },
    });
  });
});
