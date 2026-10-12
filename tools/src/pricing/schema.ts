import { z } from "zod";

const decimal = z.string().regex(/^\d+(\.\d+)?$/);

export const unitPriceSchema = z.object({
  id: z.string(),
  offerCode: z.string(),
  region: z.string(),
  sku: z.string(),
  usageType: z.string(),
  plan: z.literal("on-demand"),
  currency: z.literal("USD"),
  unit: z.string(),
  // `usd` stays the string AWS publishes, comparable byte for byte.
  // `to: null` is the open-ended last tier.
  tiers: z
    .array(
      z.object({
        from: z.number(),
        to: z.number().nullable(),
        usd: decimal,
        description: z.string(),
      }),
    )
    .min(1),
  sourceUrl: z.url(),
  offerPublicationDate: z.string(),
  checkedAt: z.iso.date(),
});
export type UnitPrice = z.infer<typeof unitPriceSchema>;

export const unitPricesSchema = z.object({ prices: z.array(unitPriceSchema) });

export const allowancesSchema = z.object({
  allowances: z.array(
    z.object({
      priceId: z.string(),
      quantity: z.number().positive(),
      period: z.literal("month"),
      kind: z.literal("always-free"),
      sourceId: z.string(),
      note: z.string(),
    }),
  ),
  // Could not be confirmed: applied as nothing, never as a guessed number.
  unknown: z.array(z.object({ priceId: z.string(), reason: z.string() })),
});
export type Allowances = z.infer<typeof allowancesSchema>;

const localized = z.object({ ja: z.string(), en: z.string() });

export const scenariosSchema = z.object({
  monthHours: z.literal(730),
  currency: z.literal("USD"),
  scenarios: z.array(
    z.object({
      id: z.string(),
      chapter: z.string(),
      title: localized,
      assumptions: z.object({ ja: z.array(z.string()), en: z.array(z.string()) }),
      items: z.array(
        z.object({ priceId: z.string(), quantity: z.number().nonnegative(), basis: z.string() }),
      ),
    }),
  ),
});
export type Scenario = z.infer<typeof scenariosSchema>["scenarios"][number];
