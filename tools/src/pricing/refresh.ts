// vp run pricing:refresh
//
// Rewrites the `tiers` of every recorded price from the AWS Price List bulk
// offers, by SKU. Public endpoint, no credentials. Review the diff: a changed
// number changes the worked examples in the book.

import { readFileSync, writeFileSync } from "node:fs";

import * as v from "valibot";

import { repoRoot } from "../data/load.ts";
import { unitPricesSchema } from "./schema.ts";

const offerSchema = v.object({
  publicationDate: v.string(),
  terms: v.object({
    OnDemand: v.record(
      v.string(),
      v.record(
        v.string(),
        v.object({
          priceDimensions: v.record(
            v.string(),
            v.object({
              beginRange: v.string(),
              endRange: v.string(),
              unit: v.string(),
              description: v.string(),
              pricePerUnit: v.object({ USD: v.string() }),
            }),
          ),
        }),
      ),
    ),
  }),
});

const path = `${repoRoot}data/pricing/unit-prices.json`;
const file = v.parse(
  v.looseObject({ prices: unitPricesSchema.entries.prices }),
  JSON.parse(readFileSync(path, "utf8")),
);
const today = new Date().toISOString().slice(0, 10);
const offers = new Map<string, v.InferOutput<typeof offerSchema>>();

for (const price of file.prices) {
  let offer = offers.get(price.sourceUrl);
  if (offer === undefined) {
    console.log(`GET ${price.sourceUrl}`);
    const response = await fetch(price.sourceUrl);
    if (!response.ok) {
      throw new Error(`${price.sourceUrl} answered ${response.status}`);
    }
    offer = v.parse(offerSchema, await response.json());
    offers.set(price.sourceUrl, offer);
  }
  const terms = offer.terms.OnDemand[price.sku];
  if (terms === undefined) {
    // Keep the old value and say so. A vanished SKU needs a human decision.
    console.error(
      `SKU ${price.sku} (${price.id}) is no longer in the offer; left unchanged, checkedAt not updated.`,
    );
    process.exitCode = 1;
    continue;
  }
  const dimensions = Object.values(terms).flatMap((term) => Object.values(term.priceDimensions));
  price.tiers = dimensions
    .map((dimension) => ({
      from: Number(dimension.beginRange),
      to: dimension.endRange === "Inf" ? null : Number(dimension.endRange),
      usd: dimension.pricePerUnit.USD,
      description: dimension.description.trim(),
    }))
    .toSorted((a, b) => a.from - b.from);
  price.unit = dimensions[0]?.unit ?? price.unit;
  price.offerPublicationDate = offer.publicationDate;
  price.checkedAt = today;
}

writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
console.log(`rewrote ${path}; review it with git diff, then run \`vp run book:generate\`.`);
