import { describe, expect, it } from "vite-plus/test";

import { type NovaModel, novaModels } from "../src/catalog.ts";
import { inferenceUsd, NOVA_2_TOKENS_PER_IMAGE, timesCheaper } from "../src/cost.ts";

const priceOf = (modelId: string) => {
  const price = (novaModels as readonly NovaModel[]).find(
    (model) => model.modelId === modelId,
  )?.usdPer1kTokens;
  if (price === undefined) {
    throw new Error(`${modelId} has no price`);
  }
  return price;
};
const nova2Lite = priceOf("amazon.nova-2-lite-v1:0");
const novaLite = priceOf("amazon.nova-lite-v1:0");
const novaMicro = priceOf("amazon.nova-micro-v1:0");

// Chapter 17's month: 1,000 summaries of 2,000 input and 150 output tokens each.
const SUMMARIES = { inputTokens: 2_000_000, outputTokens: 150_000 };

describe("the same summaries on three models", () => {
  it("costs USD 1.29 on Nova 2 Lite, chapter 17's model", () => {
    expect(inferenceUsd(nova2Lite, SUMMARIES)).toBeCloseTo(1.28865, 5);
  });

  it("costs USD 0.19 on Nova Lite and USD 0.11 on Nova Micro", () => {
    expect(inferenceUsd(novaLite, SUMMARIES)).toBeCloseTo(0.1872, 5);
    expect(inferenceUsd(novaMicro, SUMMARIES)).toBeCloseTo(0.1092, 5);
  });

  it("is about seven times cheaper on Nova Lite, and more so the more the model writes", () => {
    expect(timesCheaper(nova2Lite, novaLite, SUMMARIES)).toBeCloseTo(6.88, 2);
    // Input alone is 5.5 times, output alone 11.5 times.
    expect(timesCheaper(nova2Lite, novaLite, { inputTokens: 1, outputTokens: 0 })).toBeCloseTo(5.5);
    expect(timesCheaper(nova2Lite, novaLite, { inputTokens: 0, outputTokens: 1 })).toBeCloseTo(
      11.497,
      3,
    );
  });
});

describe("one description on Nova 2 Lite", () => {
  it("is bounded by the output limit: about a tenth of a cent", () => {
    // 230 tokens for the image, about 90 for the two prompts, and at most 300 written.
    const worst = inferenceUsd(nova2Lite, {
      inputTokens: NOVA_2_TOKENS_PER_IMAGE + 90,
      outputTokens: 300,
    });
    expect(worst).toBeCloseTo(0.00112, 5);
  });
});
