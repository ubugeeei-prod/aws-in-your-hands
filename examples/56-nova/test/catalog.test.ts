import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import {
  explainUnknown,
  iamResources,
  lifecycleOn,
  type NovaModel,
  novaModels,
  resolveRoute,
  retiredNovaModels,
  routesFor,
} from "../src/catalog.ts";
import { DESCRIBE_NEED } from "../src/env.ts";

const models: readonly NovaModel[] = novaModels;
const TODAY = new Date("2026-10-13T00:00:00Z");
const scope = { partition: "aws", region: "ap-northeast-1", account: "111122223333" };
const must = (id: string) => {
  const resolved = resolveRoute(id);
  if (resolved === undefined) {
    throw new Error(`${id} is not a route`);
  }
  return resolved;
};

describe("the family as it was listed on 2026-10-13", () => {
  it("has no model that generates an image or a video", () => {
    for (const output of ["image", "video"] as const) {
      expect(models.filter((model) => model.output.includes(output))).toEqual([]);
    }
    expect(retiredNovaModels.map((model) => model.modelId)).toEqual([
      "amazon.nova-canvas-v1:0",
      "amazon.nova-reel-v1:0",
      "amazon.nova-reel-v1:1",
      "amazon.nova-sonic-v1:0",
    ]);
  });

  it("lists the routes from Tokyo that can describe an image", () => {
    expect(routesFor(DESCRIBE_NEED).map(({ route }) => `${route.kind} ${route.id}`)).toEqual([
      "geo jp.amazon.nova-2-lite-v1:0",
      "global global.amazon.nova-2-lite-v1:0",
      "in-region amazon.nova-lite-v1:0",
      "geo apac.amazon.nova-lite-v1:0",
      "geo apac.amazon.nova-pro-v1:0",
    ]);
  });

  it("gives every route one ID, and no ID to two routes", () => {
    const ids = models.flatMap((model) => model.tokyo.map((route) => route.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(must(id).route.id).toBe(id);
    }
  });

  it("keeps a jp. profile inside Japan", () => {
    for (const model of models) {
      for (const route of model.tokyo) {
        if (route.kind === "geo" && route.id.startsWith("jp.")) {
          expect(route.destinations).toEqual(["ap-northeast-1", "ap-northeast-3"]);
        }
      }
    }
  });
});

describe("an ID that cannot be used", () => {
  it.each([
    ["amazon.nova-canvas-v1:0", /Nova Canvas .* end of life on 2026-09-30/],
    ["amazon.nova-reel-v1:1", /Nova Reel .* end of life on 2026-09-30/],
    ["amazon.nova-sonic-v1:0", /Nova Sonic .* end of life on 2026-09-14/],
    // Nova 2 Lite is not offered In-Region in Tokyo: the bare model ID is not a route.
    [
      "amazon.nova-2-lite-v1:0",
      /called from ap-northeast-1 as jp\.amazon\.nova-2-lite-v1:0 or global\./,
    ],
    ["amazon.nova-micro-v1:0", /no route from ap-northeast-1 that was confirmed/],
    ["amazon.nova-9-v1:0", /not in src\/catalog\.ts/],
  ])("says why %s is refused", (id, reason) => {
    expect(resolveRoute(id)).toBeUndefined();
    expect(explainUnknown(id)).toMatch(reason);
  });
});

describe("lifecycle", () => {
  it("counts the days to the only date the card commits to", () => {
    expect(lifecycleOn(must("jp.amazon.nova-2-lite-v1:0").model, TODAY)).toEqual({
      phase: "protected",
      days: 50,
    });
  });

  it("says when that date has passed and a retirement can be announced any day", () => {
    expect(lifecycleOn(must("amazon.nova-lite-v1:0").model, TODAY)).toEqual({
      phase: "unprotected",
      days: 312,
    });
    expect(lifecycleOn({ eolNoSoonerThan: "2026-10-13" }, TODAY).phase).toBe("unprotected");
  });
});

describe("what IAM has to name", () => {
  it("is the model alone for an In-Region call", () => {
    expect(iamResources(must("amazon.nova-lite-v1:0"), scope)).toEqual({
      modelArns: ["arn:aws:bedrock:ap-northeast-1::foundation-model/amazon.nova-lite-v1:0"],
    });
  });

  it("is the profile and the model in every destination for a geographic profile", () => {
    expect(iamResources(must("jp.amazon.nova-2-lite-v1:0"), scope)).toEqual({
      profileArn:
        "arn:aws:bedrock:ap-northeast-1:111122223333:inference-profile/jp.amazon.nova-2-lite-v1:0",
      modelArns: [
        "arn:aws:bedrock:ap-northeast-1::foundation-model/amazon.nova-2-lite-v1:0",
        "arn:aws:bedrock:ap-northeast-3::foundation-model/amazon.nova-2-lite-v1:0",
      ],
    });
    // An apac. profile leaves Japan: six Regions, each of which IAM must allow.
    expect(iamResources(must("apac.amazon.nova-pro-v1:0"), scope).modelArns).toHaveLength(6);
  });

  it("is the Region-less model ARN for a global profile", () => {
    expect(iamResources(must("global.amazon.nova-2-lite-v1:0"), scope).modelArns).toEqual([
      "arn:aws:bedrock:ap-northeast-1::foundation-model/amazon.nova-2-lite-v1:0",
      "arn:aws:bedrock:::foundation-model/amazon.nova-2-lite-v1:0",
    ]);
  });
});

describe("prices", () => {
  it("are the ones the book's price data carries", () => {
    const fragment = JSON.parse(
      readFileSync(new URL("../../../data/fragments/56.json", import.meta.url), "utf8"),
    ) as { unitPrices: { id: string; tiers: { usd: string }[] }[] };
    const usd = (id: string) =>
      Number(fragment.unitPrices.find((price) => price.id === id)?.tiers[0]?.usd);
    const priced = {
      "bedrock.nova-lite": "amazon.nova-lite-v1:0",
      "bedrock.nova-micro": "amazon.nova-micro-v1:0",
      "bedrock.nova-pro": "amazon.nova-pro-v1:0",
    };
    for (const [id, modelId] of Object.entries(priced)) {
      const model = models.find((entry) => entry.modelId === modelId);
      expect(model?.usdPer1kTokens, id).toEqual({
        input: usd(`${id}.input`),
        output: usd(`${id}.output`),
      });
    }
  });
});
