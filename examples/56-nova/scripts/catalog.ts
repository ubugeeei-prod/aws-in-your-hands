// vp run nova:catalog
//   node scripts/catalog.ts
//
// Prints src/catalog.ts against today's date. Local: no AWS call.

import {
  CHECKED_AT,
  HOME_REGION,
  lifecycleOn,
  type NovaModel,
  novaModels,
  retiredNovaModels,
  routesFor,
} from "../src/catalog.ts";
import { inferenceUsd } from "../src/cost.ts";
import { DESCRIBE_NEED } from "../src/env.ts";

const today = new Date();
const models: readonly NovaModel[] = novaModels;

console.log(
  `Amazon Nova on Bedrock as read on ${CHECKED_AT}. Today (UTC) is ${today.toISOString().slice(0, 10)}.\n`,
);
for (const model of models) {
  const life = lifecycleOn(model, today);
  const routes =
    model.tokyo.length === 0
      ? "(none confirmed)"
      : model.tokyo
          .map((route) =>
            route.kind === "geo" ? `${route.id} [${route.destinations.length} Regions]` : route.id,
          )
          .join(", ");
  console.log(
    `${model.name}  ${model.input.join("+")} -> ${model.output.join("+")}  (${model.apis.join(", ")})`,
  );
  console.log(`  from ${HOME_REGION}: ${routes}`);
  if (model.usdPer1kTokens !== undefined) {
    console.log(
      `  USD per 1K tokens: ${model.usdPer1kTokens.input} in, ${model.usdPer1kTokens.output} out`,
    );
  }
  console.log(
    life.phase === "protected"
      ? `  no end of life before ${model.eolNoSoonerThan} (${life.days} days away)`
      : `  the promise of no end of life ran out on ${model.eolNoSoonerThan} (${life.days} days ago)`,
  );
}

console.log("\nReached end of life: requests fail");
for (const model of retiredNovaModels) {
  console.log(
    `  ${model.name}  ${model.modelId}  legacy ${model.legacySince}, end of life ${model.eol}`,
  );
}

console.log(`\nRoutes that can describe an image (-c describeModel=...):`);
for (const { route } of routesFor(DESCRIBE_NEED)) {
  console.log(`  ${route.id}  (${route.kind})`);
}

// Chapter 17's month: 1,000 summaries of 2,000 input and 150 output tokens each.
console.log("\n1,000 summaries (2,000 tokens in, 150 out each), inference only:");
for (const model of models) {
  if (model.usdPer1kTokens !== undefined) {
    const usd = inferenceUsd(model.usdPer1kTokens, {
      inputTokens: 2_000_000,
      outputTokens: 150_000,
    });
    console.log(`  ${model.name.padEnd(12)} USD ${usd.toFixed(2)}`);
  }
}
