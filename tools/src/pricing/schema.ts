import * as v from "valibot";

const decimal = v.pipe(v.string(), v.regex(/^\d+(\.\d+)?$/));

export const unitPriceSchema = v.object({
  id: v.string(),
  offerCode: v.string(),
  region: v.string(),
  sku: v.string(),
  usageType: v.string(),
  plan: v.literal("on-demand"),
  currency: v.literal("USD"),
  unit: v.string(),
  // `usd` stays the string AWS publishes, comparable byte for byte.
  // `to: null` is the open-ended last tier.
  tiers: v.pipe(
    v.array(
      v.object({
        from: v.number(),
        to: v.nullable(v.number()),
        usd: decimal,
        description: v.string(),
      }),
    ),
    v.minLength(1),
  ),
  sourceUrl: v.pipe(v.string(), v.url()),
  offerPublicationDate: v.string(),
  checkedAt: v.pipe(v.string(), v.isoDate()),
});
export type UnitPrice = v.InferOutput<typeof unitPriceSchema>;

export const unitPricesSchema = v.object({ prices: v.array(unitPriceSchema) });

export const allowancesSchema = v.object({
  allowances: v.array(
    v.object({
      priceId: v.string(),
      quantity: v.pipe(v.number(), v.gtValue(0)),
      period: v.literal("month"),
      kind: v.literal("always-free"),
      sourceId: v.string(),
      note: v.string(),
    }),
  ),
  // Could not be confirmed: applied as nothing, never as a guessed number.
  unknown: v.array(v.object({ priceId: v.string(), reason: v.string() })),
});
export type Allowances = v.InferOutput<typeof allowancesSchema>;

const localized = v.object({ ja: v.string(), en: v.string() });

export const scenariosSchema = v.object({
  monthHours: v.literal(730),
  currency: v.literal("USD"),
  scenarios: v.array(
    v.object({
      id: v.string(),
      chapter: v.string(),
      title: localized,
      assumptions: v.object({ ja: v.array(v.string()), en: v.array(v.string()) }),
      items: v.array(
        v.object({
          priceId: v.string(),
          quantity: v.pipe(v.number(), v.minValue(0)),
          basis: v.string(),
        }),
      ),
    }),
  ),
});
export type Scenario = v.InferOutput<typeof scenariosSchema>["scenarios"][number];
