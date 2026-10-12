import { z } from "zod";

export const itemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  priceYen: z.number().int().nonnegative(),
});
export type Item = z.infer<typeof itemSchema>;

// #region list
export const itemListSchema = z.object({
  items: z.array(itemSchema),
  /** When the source of truth produced this list. Compare it with the clock to see how old the answer is. */
  loadedAt: z.iso.datetime(),
});
export type ItemList = z.infer<typeof itemListSchema>;
// #endregion list

export const healthSchema = z.object({
  status: z.literal("ok"),
  stage: z.string(),
  store: z.enum(["memory", "dynamodb", "valkey", "elasticache"]),
});

export const errorCodes = ["rate_limited", "unavailable", "not_found", "internal"] as const;

export const errorSchema = z.object({
  error: z.object({
    code: z.enum(errorCodes),
    message: z.string(),
    requestId: z.string(),
  }),
});
export type ErrorBody = z.infer<typeof errorSchema>;
