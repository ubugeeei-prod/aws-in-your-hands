import * as v from "valibot";

import { usageSchema } from "./usage.ts";

const count = v.pipe(v.number(), v.integer(), v.minValue(0));

// #region shape
// Strict on purpose, as in chapter 19: a field nobody listed here (a question, a note, a
// tool result) fails the test instead of reaching CloudWatch Logs.
export const inferenceLineSchema = v.strictObject({
  level: v.picklist(["info", "warn"]),
  message: v.picklist(["assistant", "action_items"]),
  requestId: v.pipe(v.string(), v.minLength(1)),
  // Who the cost belongs to. An opaque ID, never a name or an address.
  owner: v.pipe(v.string(), v.minLength(1)),
  modelId: v.string(),
  backend: v.picklist(["scripted", "bedrock"]),
  // One word: complete, a stop reason, or a failure code.
  outcome: v.pipe(v.string(), v.minLength(1)),
  turns: count,
  toolCalls: count,
  toolErrors: count,
  // The billed quantities, summed over every turn the model reported.
  usage: usageSchema,
  costMicroUsd: count,
  durationMs: v.pipe(v.number(), v.minValue(0)),
});
export type InferenceLine = v.InferOutput<typeof inferenceLineSchema>;
// #endregion shape
