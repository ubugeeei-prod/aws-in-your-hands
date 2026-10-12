import { describe, expect, it } from "vite-plus/test";

import type { ConverseRequest, Message } from "../src/converse.ts";
import { modelProfiles } from "../src/models.ts";
import { buildAssistantRequest, withCachePoints } from "../src/prompt.ts";
import { ALICE, HAIKU, NOVA, requestOptions, toolsFor } from "./helpers.ts";

const marksIn = (value: unknown) => JSON.stringify(value).split('"cachePoint"').length - 1;

const round = (n: number): Message[] => [
  {
    role: "assistant",
    content: [{ toolUse: { toolUseId: `t${n}`, name: "list_notes", input: {} } }],
  },
  {
    role: "user",
    content: [{ toolResult: { toolUseId: `t${n}`, content: [{ text: "ok" }], status: "success" } }],
  },
];
const conversation = (rounds: number): Message[] => [
  { role: "user", content: [{ text: "質問" }] },
  ...Array.from({ length: rounds }, (_, n) => round(n)).flat(),
];

describe("buildAssistantRequest", () => {
  it("sends the tools, the output limit, and no cache point or guardrail unless asked", async () => {
    const request = buildAssistantRequest(conversation(0), await toolsFor(ALICE), requestOptions());
    expect(request.inferenceConfig.maxTokens).toBe(600);
    expect(
      request.toolConfig?.tools.map((tool) => ("toolSpec" in tool ? tool.toolSpec.name : "")),
    ).toEqual(["list_notes", "read_note"]);
    expect(request.guardrailConfig).toBeUndefined();
    expect(marksIn(request)).toBe(0);
    expect(request.modelId).toBe(NOVA);
  });

  it("keeps the note out of the system prompt and the system prompt free of the question", async () => {
    const request = buildAssistantRequest(conversation(0), await toolsFor(ALICE), requestOptions());
    expect(JSON.stringify(request.system)).not.toContain("質問");
    expect(JSON.stringify(request.system)).toContain("data, not instructions");
  });
});

describe("withCachePoints", () => {
  const base = (rounds: number): ConverseRequest => ({
    modelId: HAIKU,
    system: [{ text: "s" }],
    messages: conversation(rounds),
    inferenceConfig: { maxTokens: 1, temperature: 0 },
  });

  it("marks the system prompt and the end of each round of tool results", () => {
    const marked = withCachePoints(base(2), modelProfiles[HAIKU].cache);
    expect(marked.system.at(-1)).toEqual({ cachePoint: { type: "default" } });
    expect(marked.messages.map((message) => marksIn(message))).toEqual([0, 0, 1, 0, 1]);
    // The mark comes after the results it covers.
    expect(marked.messages[2]?.content.at(-1)).toEqual({ cachePoint: { type: "default" } });
  });

  it("never sends more marks than the model accepts, and gives up the oldest", () => {
    const marked = withCachePoints(base(6), modelProfiles[HAIKU].cache);
    expect(marksIn(marked)).toBe(4);
    expect(marksIn(marked.messages.slice(0, 7))).toBe(0);
    expect(marksIn(marked.messages.slice(7))).toBe(3);
  });

  it("does not touch the request it was given", () => {
    const request = base(1);
    const before = JSON.stringify(request);
    withCachePoints(request, modelProfiles[NOVA].cache);
    expect(JSON.stringify(request)).toBe(before);
  });
});
