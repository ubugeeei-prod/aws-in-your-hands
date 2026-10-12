import { readFileSync } from "node:fs";

import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { disagreements, previewSchema, toImages } from "../src/describe.ts";
import { evaluate } from "../src/lifecycle.ts";
import { POLICY } from "../src/policy.ts";
import { digestOf } from "./digests.ts";

const NOW = new Date("2026-10-13T00:00:00Z");
// Written for this chapter in the shape of `aws ecr describe-images`. Not captured from AWS.
const fixture: unknown = JSON.parse(
  readFileSync(new URL("../fixtures/describe-images.json", import.meta.url), "utf8"),
);

describe("reading describe-images", () => {
  it("turns the CLI's output into the evaluator's images, untagged ones included", () => {
    const images = toImages(fixture);
    expect(images).toHaveLength(46);
    expect(images.filter((image) => image.tags.length === 0)).toHaveLength(2);
    expect(images[0]?.pushedAt).toEqual(new Date("2026-08-30T09:00:00Z"));
  });

  it("refuses an image without a push time rather than treat it as new or old", () => {
    expect(() => toImages({ imageDetails: [{ imageDigest: digestOf("a") }] })).toThrow();
  });

  it("expires from the fixture what the preview task prints", () => {
    const expired = evaluate(POLICY, toImages(fixture), NOW);
    const count = (rulePriority: number) =>
      expired.filter((image) => image.rulePriority === rulePriority).length;
    expect([count(1), count(2), count(3)]).toEqual([2, 1, 8]);
  });
});

describe("comparing with ECR's preview", () => {
  const a = digestOf("a");
  const b = digestOf("b");
  const preview = (results: { imageDigest: string; appliedRulePriority: number }[]) =>
    v.parse(previewSchema, {
      status: "COMPLETE",
      previewResults: results.map((result) => ({ ...result, action: { type: "EXPIRE" } })),
    });

  it("reports nothing when both expire the same images by the same rules", () => {
    const mine = [
      { digest: a, rulePriority: 1 },
      { digest: b, rulePriority: 3 },
    ];
    const theirs = preview([
      { imageDigest: b, appliedRulePriority: 3 },
      { imageDigest: a, appliedRulePriority: 1 },
    ]);
    expect(disagreements(mine, theirs)).toEqual([]);
  });

  it("reports an image only one side expires, and an image expired by different rules", () => {
    const mine = [{ digest: a, rulePriority: 1 }];
    expect(disagreements(mine, preview([]))).toEqual([`${a}: local 1, ECR keeps`]);
    expect(disagreements([], preview([{ imageDigest: a, appliedRulePriority: 2 }]))).toEqual([
      `${a}: local keeps, ECR 2`,
    ]);
    expect(disagreements(mine, preview([{ imageDigest: a, appliedRulePriority: 3 }]))).toEqual([
      `${a}: local 1, ECR 3`,
    ]);
  });
});
