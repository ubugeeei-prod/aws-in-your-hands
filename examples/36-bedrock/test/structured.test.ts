import { describe, expect, it } from "vite-plus/test";

import { modelProfiles } from "../src/models.ts";
import { createScriptedModel } from "../src/scripted-model.ts";
import {
  ACTION_ITEMS_JSON_SCHEMA,
  buildExtractionRequest,
  checkActionItems,
  createExtractor,
} from "../src/structured.ts";
import { type TranscriptName, transcripts } from "../src/transcripts.ts";
import { HAIKU, never, NOVA, requestOptions } from "./helpers.ts";

const NOTE = {
  title: "リリース前の確認",
  body: "金曜のリリースまでに、決済の結合テストと負荷試験を終える。担当は佐藤さんと鈴木さん。",
};

function setup(name: TranscriptName, modelId: typeof NOVA | typeof HAIKU = NOVA) {
  const model = createScriptedModel(transcripts[name]);
  const extract = createExtractor({
    gateway: model,
    request: requestOptions({ modelId, profile: modelProfiles[modelId] }),
    timeoutMs: 60_000,
    timeoutSignal: () => never,
  });
  return { model, extract };
}

describe("asking for JSON", () => {
  it("asks a model without structured outputs for one tool by name, and reads its input", async () => {
    const { model, extract } = setup("structured-tool-valid");
    const result = await extract(NOTE, never);
    expect(result).toMatchObject({ ok: true, attempts: 1 });
    expect(result.ok ? result.value.items : []).toHaveLength(3);
    const [request] = model.requests;
    expect(request?.outputConfig).toBeUndefined();
    expect(request?.toolConfig?.toolChoice).toEqual({ tool: { name: "record_action_items" } });
  });

  it("gives a model with structured outputs the schema as a string, and no tool", async () => {
    const { model, extract } = setup("structured-json-valid", HAIKU);
    const result = await extract(NOTE, never);
    expect(result).toMatchObject({ ok: true, attempts: 1 });
    const [request] = model.requests;
    expect(request?.toolConfig).toBeUndefined();
    const schema = request?.outputConfig?.textFormat.structure.jsonSchema.schema ?? "";
    expect(JSON.parse(schema)).toEqual(ACTION_ITEMS_JSON_SCHEMA);
  });

  it("uses only the JSON Schema features Bedrock lists as supported", () => {
    const text = JSON.stringify(ACTION_ITEMS_JSON_SCHEMA);
    for (const unsupported of [
      "minLength",
      "maxLength",
      "minimum",
      "maximum",
      "pattern",
      "maxItems",
      "$ref",
    ]) {
      expect(text, unsupported).not.toContain(`"${unsupported}"`);
    }
    // Every object is closed, as the documented examples are.
    expect(text.split('"type":"object"').length - 1).toBe(
      text.split('"additionalProperties":false').length - 1,
    );
  });
});

describe("the boundary", () => {
  it("lets through only what the schema describes", () => {
    const item = { task: "負荷試験を終える", owner: null, due: "2026-10-16" };
    expect(checkActionItems(JSON.stringify({ items: [item] }))).toMatchObject({ ok: true });
    for (const wrong of [
      "not json",
      JSON.stringify({ items: [{ ...item, due: "金曜" }] }),
      JSON.stringify({ items: [{ ...item, task: "" }] }),
      JSON.stringify({ items: [{ ...item, priority: "high" }] }),
      JSON.stringify({ items: [item], note: "extra" }),
      JSON.stringify({ items: Array.from({ length: 21 }, () => item) }),
      JSON.stringify([item]),
    ]) {
      expect(checkActionItems(wrong).ok, wrong.slice(0, 40)).toBe(false);
    }
    expect(checkActionItems(undefined).ok).toBe(false);
  });
});

describe("repair", () => {
  it("says what was wrong once, as the result of the tool request, and takes the corrected JSON", async () => {
    const { model, extract } = setup("structured-tool-repair");
    const result = await extract(NOTE, never);
    expect(result).toMatchObject({
      ok: true,
      attempts: 2,
      // Both calls are paid for: 410 + 520 in, 40 + 96 out.
      usage: { inputTokens: 930, outputTokens: 136 },
    });
    expect(model.requests).toHaveLength(2);
    const complaint = model.requests[1]?.messages[2];
    expect(complaint).toMatchObject({
      role: "user",
      content: [{ toolResult: { toolUseId: "tooluse_fixture_01", status: "error" } }],
    });
    expect(JSON.stringify(complaint)).toContain("items.0.due");
  });

  it("stops after one correction", async () => {
    const { model, extract } = setup("structured-unrepairable");
    expect(await extract(NOTE, never)).toMatchObject({
      ok: false,
      failure: { code: "bad_output", retryable: false },
      attempts: 2,
    });
    expect(model.requests).toHaveLength(2);
  });

  it("does not try to correct an answer that was cut off", async () => {
    const { model, extract } = setup("structured-max-tokens", HAIKU);
    expect(await extract(NOTE, never)).toMatchObject({
      ok: false,
      failure: { code: "bad_output" },
      stopReason: "max_tokens",
      attempts: 1,
    });
    expect(model.requests).toHaveLength(1);
  });

  it("reports throttling as throttling, not as bad output", async () => {
    const { extract } = setup("always-throttled");
    expect(await extract(NOTE, never)).toMatchObject({
      ok: false,
      failure: { code: "throttled", retryable: true },
    });
  });
});

describe("buildExtractionRequest", () => {
  it("attaches the guardrail in either form", () => {
    for (const modelId of [NOVA, HAIKU] as const) {
      const request = buildExtractionRequest([], {
        ...requestOptions({ modelId, profile: modelProfiles[modelId] }),
        guardrail: { id: "gr1abcd2ef", version: "3" },
      });
      expect(request.guardrailConfig?.guardrailVersion, modelId).toBe("3");
    }
  });
});
