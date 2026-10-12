import type { NovaModel } from "./catalog.ts";

// #region cost
export type Usage = { inputTokens: number; outputTokens: number };

/** The Nova 2 guide: an image is billed as this many input tokens, whatever its size. */
export const NOVA_2_TOKENS_PER_IMAGE = 230;

/** List price of the tokens alone. Lambda, S3 and data transfer are not in it. */
export function inferenceUsd(
  price: NonNullable<NovaModel["usdPer1kTokens"]>,
  usage: Usage,
): number {
  return (usage.inputTokens / 1000) * price.input + (usage.outputTokens / 1000) * price.output;
}

/** How many times the first price is the second, for the same token counts. */
export function timesCheaper(
  expensive: NonNullable<NovaModel["usdPer1kTokens"]>,
  cheap: NonNullable<NovaModel["usdPer1kTokens"]>,
  usage: Usage,
): number {
  return inferenceUsd(expensive, usage) / inferenceUsd(cheap, usage);
}
// #endregion cost
