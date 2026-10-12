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

/** Who is being limited. Self-declared here; chapter 06 shows how to take it from a verified token. */
export const clientIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const healthSchema = z.object({
  status: z.literal("ok"),
  stage: z.string(),
  store: z.enum(["memory", "dynamodb", "valkey", "elasticache"]),
});

export const errorCodes = [
  "invalid_request",
  "rate_limited",
  "unavailable",
  "not_found",
  "internal",
] as const;

export const errorSchema = z.object({
  error: z.object({
    code: z.enum(errorCodes),
    message: z.string(),
    requestId: z.string(),
  }),
});
export type ErrorBody = z.infer<typeof errorSchema>;
