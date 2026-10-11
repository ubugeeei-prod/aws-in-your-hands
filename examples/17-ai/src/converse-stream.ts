import { z } from "zod";

// #region schema
// The ConverseStream events this example reads. Each event carries one key.
// Keys not listed here (new event kinds) pass through and are ignored; a listed
// key with the wrong shape fails.
export const converseStreamEventSchema = z.looseObject({
  messageStart: z.object({ role: z.string() }).optional(),
  contentBlockDelta: z
    .object({
      contentBlockIndex: z.number().int().nonnegative().optional(),
      // `text` is absent for the other delta kinds (reasoning, tool use).
      delta: z.looseObject({ text: z.string().optional() }),
    })
    .optional(),
  messageStop: z.object({ stopReason: z.string().min(1) }).optional(),
  metadata: z
    .object({
      usage: z.looseObject({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
      }),
    })
    .optional(),
});
export type ConverseStreamEvent = z.infer<typeof converseStreamEventSchema>;
// #endregion schema

// #region converse
/** The part of a (non-streaming) Converse response this example reads. */
export const converseResponseSchema = z.object({
  output: z.object({
    message: z.object({
      role: z.literal("assistant"),
      content: z.array(z.looseObject({ text: z.string().optional() })),
    }),
  }),
  stopReason: z.string().min(1),
  usage: z.looseObject({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
});
// #endregion converse

/** The API reference lists exceptions as stream events too, named like `throttlingException`. */
export function exceptionNameIn(event: ConverseStreamEvent): string | undefined {
  const key = Object.keys(event).find((candidate) => candidate.endsWith("Exception"));
  return key === undefined ? undefined : key.charAt(0).toUpperCase() + key.slice(1);
}
