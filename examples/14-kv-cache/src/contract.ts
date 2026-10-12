import * as v from "valibot";

export const itemSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  name: v.pipe(v.string(), v.minLength(1)),
  priceYen: v.pipe(v.number(), v.integer(), v.minValue(0)),
});
export type Item = v.InferOutput<typeof itemSchema>;

// #region list
export const itemListSchema = v.object({
  items: v.array(itemSchema),
  /** When the source of truth produced this list. Compare it with the clock to see how old the answer is. */
  loadedAt: v.pipe(v.string(), v.isoTimestamp()),
});
export type ItemList = v.InferOutput<typeof itemListSchema>;
// #endregion list

export const healthSchema = v.object({
  status: v.literal("ok"),
  stage: v.string(),
  store: v.picklist(["memory", "dynamodb", "valkey", "elasticache"]),
});

export const errorCodes = ["rate_limited", "unavailable", "not_found", "internal"] as const;

export const errorSchema = v.object({
  error: v.object({
    code: v.picklist(errorCodes),
    message: v.string(),
    requestId: v.string(),
  }),
});
export type ErrorBody = v.InferOutput<typeof errorSchema>;
