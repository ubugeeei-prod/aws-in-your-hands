// The parts of the Converse API this example sends and reads. The request shape is the
// one ConverseStream documents. The events are checked as they arrive, because the SDK's
// types describe the contract, not what actually came over the wire.

import * as v from "valibot";

// #region request
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

/** Marks the end of a prefix the model may reuse from its cache on the next call. */
export type CachePoint = { cachePoint: { type: "default" } };

export type ToolUseBlock = { toolUse: { toolUseId: string; name: string; input: Json } };
export type ToolResultBlock = {
  toolResult: {
    toolUseId: string;
    content: ({ text: string } | { json: JsonObject })[];
    status: "success" | "error";
  };
};
export type ContentBlock = { text: string } | ToolUseBlock | ToolResultBlock | CachePoint;
export type Message = { role: "user" | "assistant"; content: ContentBlock[] };

export type ToolSpec = {
  toolSpec: { name: string; description: string; inputSchema: { json: JsonObject } };
};

export type ConverseRequest = {
  modelId: string;
  system: ({ text: string } | CachePoint)[];
  messages: Message[];
  inferenceConfig: { maxTokens: number; temperature: number };
  toolConfig?: {
    tools: (ToolSpec | CachePoint)[];
    toolChoice?: { auto: Record<string, never> } | { tool: { name: string } };
  };
  guardrailConfig?: {
    guardrailIdentifier: string;
    guardrailVersion: string;
    trace: "enabled" | "disabled";
    streamProcessingMode: "sync" | "async";
  };
  outputConfig?: {
    textFormat: {
      type: "json_schema";
      // The schema travels as a string of JSON, not as an object.
      structure: { jsonSchema: { name: string; description: string; schema: string } };
    };
  };
};
// #endregion request

const count = v.pipe(v.number(), v.integer(), v.minValue(0));
const index = v.optional(count);

// #region events
// Each event carries one key. Keys not listed here pass through and are ignored. A listed
// key with the wrong shape fails.
export const streamEventSchema = v.looseObject({
  messageStart: v.optional(v.object({ role: v.string() })),
  // Sent for a tool request only: the name and the ID arrive before any of its input.
  contentBlockStart: v.optional(
    v.object({
      contentBlockIndex: index,
      start: v.looseObject({
        toolUse: v.optional(
          v.looseObject({
            toolUseId: v.pipe(v.string(), v.minLength(1)),
            name: v.pipe(v.string(), v.minLength(1)),
          }),
        ),
      }),
    }),
  ),
  contentBlockDelta: v.optional(
    v.object({
      contentBlockIndex: index,
      delta: v.looseObject({
        text: v.optional(v.string()),
        // A piece of the input, as text. It is JSON only once every piece has arrived.
        toolUse: v.optional(v.looseObject({ input: v.string() })),
      }),
    }),
  ),
  contentBlockStop: v.optional(v.object({ contentBlockIndex: index })),
  messageStop: v.optional(v.looseObject({ stopReason: v.pipe(v.string(), v.minLength(1)) })),
  metadata: v.optional(
    v.looseObject({
      usage: v.looseObject({
        inputTokens: count,
        outputTokens: count,
        // Present only when the call read from, or wrote to, the prompt cache.
        cacheReadInputTokens: v.optional(count),
        cacheWriteInputTokens: v.optional(count),
      }),
    }),
  ),
});
export type StreamEvent = v.InferOutput<typeof streamEventSchema>;
// #endregion events

// #region stop
/** The values MessageStopEvent documents. A value outside this list is treated as unfinished. */
export const STOP_REASONS = [
  "end_turn",
  "tool_use",
  "max_tokens",
  "stop_sequence",
  "guardrail_intervened",
  "content_filtered",
  "malformed_model_output",
  "malformed_tool_use",
  "model_context_window_exceeded",
] as const;
// #endregion stop
