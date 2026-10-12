import * as v from "valibot";

import { failureCodes } from "@aih/example-17-ai/src/contract.ts";

import { usageSchema } from "./usage.ts";

// #region request
/** A question is short. The notes it is about arrive through the tools, not through here. */
export const MAX_QUESTION_CHARS = 500;

export const askRequestSchema = v.object({
  question: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(MAX_QUESTION_CHARS)),
});
export type AskRequest = v.InferOutput<typeof askRequestSchema>;
// #endregion request

// #region events
const turns = v.pipe(v.number(), v.integer(), v.minValue(0));

export const assistantEventSchema = v.variant("type", [
  v.object({ type: v.literal("delta"), text: v.string() }),
  // A tool ran, or was refused. The input and the result stay on the server.
  v.object({ type: v.literal("tool"), name: v.string(), ok: v.boolean() }),
  // The guardrail's own message. Whatever text came before it is to be thrown away.
  v.object({ type: v.literal("blocked"), text: v.string() }),
  // Exactly one of the next two ends every stream that was not cut.
  v.object({
    type: v.literal("done"),
    stopReason: v.string(),
    // True only when the model finished its answer on its own.
    complete: v.boolean(),
    turns,
    usage: usageSchema,
  }),
  v.object({
    type: v.literal("error"),
    code: v.picklist(failureCodes),
    retryable: v.boolean(),
    turns,
    // What the model reported before the failure. A call that failed midway reports nothing.
    usage: usageSchema,
  }),
]);
export type AssistantEvent = v.InferOutput<typeof assistantEventSchema>;
// #endregion events

// #region action-items
/** What `POST /notes/:id/action-items` answers with, and what the model's JSON is checked against. */
export const actionItemsSchema = v.strictObject({
  items: v.pipe(
    v.array(
      v.strictObject({
        task: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
        // Who is to do it, when the note says so.
        owner: v.nullable(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80))),
        // A calendar day, when the note names one.
        due: v.nullable(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/))),
      }),
    ),
    v.maxLength(20),
  ),
});
export type ActionItems = v.InferOutput<typeof actionItemsSchema>;
// #endregion action-items

export const healthSchema = v.object({
  status: v.literal("ok"),
  stage: v.string(),
  backend: v.picklist(["scripted", "bedrock"]),
  modelId: v.string(),
});

// #region error
export const errorSchema = v.object({
  error: v.object({
    code: v.picklist([
      "invalid_request",
      "unauthorized",
      "not_found",
      "payload_too_large",
      "budget_exceeded",
      ...failureCodes,
    ]),
    message: v.string(),
    requestId: v.string(),
    retryable: v.optional(v.boolean()),
    issues: v.optional(v.array(v.object({ path: v.string(), message: v.string() }))),
  }),
});
export type ErrorBody = v.InferOutput<typeof errorSchema>;
// #endregion error
