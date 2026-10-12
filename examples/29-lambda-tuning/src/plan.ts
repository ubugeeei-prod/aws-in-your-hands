// What a memory setting and a number of kept environments cost, as lines for the
// pricing calculator. Prices are not here: `scripts/plan.ts` takes them from data/pricing.

import { gbSeconds, provisionedGbSeconds } from "./cost-inputs.ts";

export type PlanItem = { priceId: string; quantity: number; basis: string };

// #region items
/** Requests and duration for a month of invocations that all take `billedMs`. */
export function invocationItems(input: {
  memoryMb: number;
  billedMs: number;
  invocations: number;
}): PlanItem[] {
  return [
    {
      priceId: "lambda.request.arm",
      quantity: input.invocations,
      basis: `${input.invocations} invocations`,
    },
    {
      priceId: "lambda.duration.arm",
      quantity: gbSeconds(input),
      basis: `${input.invocations} x ${input.billedMs} ms x ${input.memoryMb} MB, in GB-seconds`,
    },
  ];
}

/** Environments kept initialized for a 730-hour month. Billed whether or not a request comes. */
export function provisionedItems(input: { memoryMb: number; concurrency: number }): PlanItem[] {
  return [
    {
      priceId: "lambda.provisioned.arm",
      quantity: provisionedGbSeconds(input),
      basis: `${input.concurrency} x ${input.memoryMb} MB x 2,628,000 s, in GB-seconds`,
    },
  ];
}
// #endregion items

/** The settings the comparison in `vp run tune:plan` walks through. */
export const MEMORY_STEPS = [128, 256, 512, 1024, 1769, 3008] as const;
