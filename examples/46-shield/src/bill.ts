import type { Count } from "./flood.ts";

// #region shape
/** What one answer weighs and what one run of the function takes. Assumed, not measured. */
export type Shape = { responseBytes: number; functionMs: number; memoryMb: number };

export const SHAPE: Shape = { responseBytes: 1024, functionMs: 50, memoryMb: 256 };
// #endregion shape

export type Item = { priceId: string; quantity: number; basis: string };

const GIB = 1024 ** 3;
/** The price calculator keeps six decimal places of a quantity. */
const micro = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

// #region items
/**
 * The usage a flood leaves behind, as lines for tools/src/pricing/calc.ts.
 * `webAcl` says whether AWS WAF looked at the requests at all.
 */
export function billItems(count: Count, webAcl: boolean, shape: Shape = SHAPE): Item[] {
  // CloudFront does not charge for a request that AWS WAF blocked. AWS WAF does.
  const pastEdge = count.sent - count.blocked;
  // A 429 from the brake is a small answer. Its bytes are left out.
  const answered = count.cached + count.origin;
  return [
    {
      priceId: "cloudfront.jp.request.https",
      quantity: pastEdge,
      basis: `${pastEdge} requests CloudFront answered or passed on`,
    },
    {
      priceId: "cloudfront.jp.transfer",
      quantity: micro((answered * shape.responseBytes) / GIB),
      basis: `${answered} answers x ${shape.responseBytes} bytes`,
    },
    ...(webAcl
      ? [
          {
            priceId: "waf.global.request",
            quantity: count.sent,
            basis: `${count.sent} requests inspected, blocked or not`,
          },
        ]
      : []),
    {
      priceId: "lambda.request.arm",
      quantity: count.origin,
      basis: `${count.origin} invocations`,
    },
    {
      priceId: "lambda.duration.arm",
      quantity: micro((count.origin * shape.functionMs * shape.memoryMb) / (1000 * 1024)),
      basis: `${count.origin} invocations x ${shape.functionMs} ms x ${shape.memoryMb} MB`,
    },
  ];
}
// #endregion items
