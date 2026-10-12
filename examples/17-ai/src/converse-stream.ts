import * as v from "valibot";

const count = v.pipe(v.number(), v.integer(), v.minValue(0));

// #region schema
// The ConverseStream events this example reads. Each event carries one key.
// Keys not listed here (new event kinds) pass through and are ignored; a listed
// key with the wrong shape fails.
export const converseStreamEventSchema = v.looseObject({
  messageStart: v.optional(v.object({ role: v.string() })),
  contentBlockDelta: v.optional(
    v.object({
      contentBlockIndex: v.optional(count),
      // `text` is absent for the other delta kinds (reasoning, tool use).
      delta: v.looseObject({ text: v.optional(v.string()) }),
    }),
  ),
  messageStop: v.optional(v.object({ stopReason: v.pipe(v.string(), v.minLength(1)) })),
  metadata: v.optional(
    v.object({
      usage: v.looseObject({ inputTokens: count, outputTokens: count }),
    }),
  ),
});
export type ConverseStreamEvent = v.InferOutput<typeof converseStreamEventSchema>;
// #endregion schema

// #region converse
/** The part of a (non-streaming) Converse response this example reads. */
export const converseResponseSchema = v.object({
  output: v.object({
    message: v.object({
      role: v.literal("assistant"),
      content: v.array(v.looseObject({ text: v.optional(v.string()) })),
    }),
  }),
  stopReason: v.pipe(v.string(), v.minLength(1)),
  usage: v.looseObject({ inputTokens: count, outputTokens: count }),
});
// #endregion converse

/** The API reference lists exceptions as stream events too, named like `throttlingException`. */
export function exceptionNameIn(event: ConverseStreamEvent): string | undefined {
  const key = Object.keys(event).find((candidate) => candidate.endsWith("Exception"));
  return key === undefined ? undefined : key.charAt(0).toUpperCase() + key.slice(1);
}
