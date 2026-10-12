import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import {
  evaluate,
  expiredInUse,
  type Image,
  type LifecyclePolicy,
  lifecyclePolicySchema,
} from "../src/lifecycle.ts";
import { buildTag, KEEP, POLICY, releaseTag } from "../src/policy.ts";
import { digestOf } from "./digests.ts";

const NOW = new Date("2026-10-13T00:00:00Z");
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const image = (name: string, tags: string[], days: number): Image => ({
  digest: name,
  tags,
  pushedAt: daysAgo(days),
});
const policy = (rules: unknown[]): LifecyclePolicy => v.parse(lifecyclePolicySchema, { rules });
const countRule = (rulePriority: number, tagPatternList: string[], countNumber = 1) => ({
  rulePriority,
  selection: { tagStatus: "tagged", tagPatternList, countType: "imageCountMoreThan", countNumber },
  action: { type: "expire" },
});
const expiredNames = (subject: LifecyclePolicy, images: Image[]) =>
  evaluate(subject, images, NOW)
    .map((expired) => expired.digest)
    .toSorted();

// Repositories, policies and outcomes copied from "Examples of lifecycle policies in Amazon ECR".
describe("the documentation's worked examples", () => {
  const abc = [
    image("A", ["beta-1", "prod-1"], 10),
    image("B", ["beta-2", "prod-2"], 9),
    image("C", ["beta-3"], 8),
  ];

  it("multiple rules, example A: a lower rule cannot expire what a higher rule selects", () => {
    expect(expiredNames(policy([countRule(1, ["prod*"]), countRule(2, ["beta*"])]), abc)).toEqual([
      "A",
    ]);
  });

  it("multiple rules, example B: the same rules in the other order expire two images", () => {
    expect(expiredNames(policy([countRule(1, ["beta*"]), countRule(2, ["prod*"])]), abc)).toEqual([
      "A",
      "B",
    ]);
  });

  it("multiple tags in one rule, example A: an image must match every pattern", () => {
    const images = [
      image("A", ["alpha-1"], 12),
      image("B", ["beta-1"], 11),
      image("C", ["alpha-2", "beta-2"], 10),
      image("D", ["alpha-3"], 4),
      image("E", ["beta-3"], 3),
      image("F", ["alpha-4", "beta-4"], 2),
    ];
    const aged = policy([
      {
        rulePriority: 1,
        selection: {
          tagStatus: "tagged",
          tagPatternList: ["alpha*", "beta*"],
          countType: "sinceImagePushed",
          countUnit: "days",
          countNumber: 5,
        },
        action: { type: "expire" },
      },
    ]);
    expect(expiredNames(aged, images)).toEqual(["C"]);
  });

  it("multiple tags in one rule, example B: other tags on the image do not exempt it", () => {
    const images = [
      image("A", ["alpha-1", "beta-1", "gamma-1"], 10),
      image("B", ["alpha-2", "beta-2"], 9),
      image("C", ["alpha-3", "beta-3", "gamma-2"], 8),
    ];
    expect(expiredNames(policy([countRule(1, ["alpha*", "beta*"])]), images)).toEqual(["A", "B"]);
  });

  const anyRule = (rulePriority: number) => ({
    rulePriority,
    selection: { tagStatus: "any", countType: "imageCountMoreThan", countNumber: 1 },
    action: { type: "expire" },
  });

  it("all images, example A: any counts tagged and untagged images together", () => {
    const images = [
      image("A", ["alpha-1"], 4),
      image("B", ["beta-1"], 3),
      image("C", [], 2),
      image("D", ["alpha-2"], 1),
    ];
    expect(expiredNames(policy([anyRule(1)]), images)).toEqual(["A", "B", "C"]);
  });

  it("all images, example B: three kinds of rule in one policy", () => {
    const images = [
      image("A", ["alpha-1", "beta-1"], 4),
      image("B", [], 3),
      image("C", ["alpha-2"], 2),
      image("D", ["git hash"], 1),
      // The documentation gives D and E the same age and expires D, so E is taken as the newer.
      image("E", [], 0.99),
    ];
    const combined = policy([
      countRule(1, ["alpha*"]),
      {
        rulePriority: 2,
        selection: {
          tagStatus: "untagged",
          countType: "sinceImagePushed",
          countUnit: "days",
          countNumber: 1,
        },
        action: { type: "expire" },
      },
      anyRule(3),
    ]);
    expect(expiredNames(combined, images)).toEqual(["A", "B", "D"]);
  });
});

describe("this chapter's policy", () => {
  it("is a policy the schema accepts", () => {
    expect(v.parse(lifecyclePolicySchema, POLICY)).toEqual(POLICY);
  });

  // One build a day, newest last; every `releaseEvery`-th build was released.
  const history = (builds: number, releaseEvery: number): Image[] =>
    Array.from({ length: builds }, (_, index) => {
      const age = builds - index;
      const tags = [buildTag(String(index).padStart(7, "0"))];
      if (index % releaseEvery === 0) {
        tags.push(releaseTag(`1.${index / releaseEvery}.0`));
      }
      return { digest: digestOf(`build ${index}`), tags, pushedAt: daysAgo(age) };
    });

  it("keeps the newest releases however old they are, and never more than the limit", () => {
    const images = history(400, 10);
    const expired = new Set(evaluate(POLICY, images, NOW).map((entry) => entry.digest));
    const releases = images.filter((entry) => entry.tags.some((tag) => tag.startsWith("v")));

    const kept = releases.filter((entry) => !expired.has(entry.digest));
    expect(kept).toEqual(releases.slice(-KEEP.releases));
    // The oldest release kept is about 200 days old: age alone never expires a release.
    expect(kept[0]?.pushedAt).toEqual(daysAgo(200));
  });

  it("counts releases among the newest images, so fewer plain builds survive than the limit says", () => {
    const images = history(400, 2);
    const expired = new Set(evaluate(POLICY, images, NOW).map((entry) => entry.digest));
    const plain = images.filter((entry) => entry.tags.length === 1);

    // Rule 3 keeps the 30 newest images of any kind. Half of those are releases.
    expect(plain.filter((entry) => !expired.has(entry.digest))).toHaveLength(KEEP.images / 2);
  });

  it("expires an untagged image only once it is a day old", () => {
    const images = [
      { digest: "fresh", tags: [], pushedAt: new Date(NOW.getTime() - DAY + 1) },
      { digest: "stale", tags: [], pushedAt: new Date(NOW.getTime() - DAY - 1) },
    ];
    expect(evaluate(POLICY, images, NOW)).toEqual([{ digest: "stale", tags: [], rulePriority: 2 }]);
  });

  it("gives the same answer whatever order the images are listed in", () => {
    const images = history(120, 3);
    const reversed = images.toReversed();
    expect(expiredNames(POLICY, reversed)).toEqual(expiredNames(POLICY, images));
  });

  it("would delete an image production still runs, if production stayed on an unreleased build", () => {
    const images = history(100, 5);
    const stuck = images.find((entry) => entry.tags.length === 1 && entry.pushedAt < daysAgo(60));
    const released = images.find(
      (entry) => entry.tags.length === 2 && entry.pushedAt < daysAgo(60),
    );
    const expired = evaluate(POLICY, images, NOW);

    expect(expiredInUse(expired, [stuck?.digest ?? ""])).toHaveLength(1);
    // A release tag is what protects a running image: the policy knows nothing about tasks.
    expect(expiredInUse(expired, [released?.digest ?? ""])).toEqual([]);
  });
});

describe("policies the schema refuses", () => {
  const untagged = (rulePriority: number) => ({
    rulePriority,
    selection: { tagStatus: "untagged", countType: "imageCountMoreThan", countNumber: 1 },
    action: { type: "expire" },
  });
  const refused = (rules: unknown[]) => v.safeParse(lifecyclePolicySchema, { rules }).success;

  it("two rules with one priority", () => {
    expect(refused([countRule(1, ["a*"]), countRule(1, ["b*"])])).toBe(false);
  });

  it("a rule for any image that is not the last", () => {
    const any = { ...untagged(1), selection: { ...untagged(1).selection, tagStatus: "any" } };
    expect(refused([any, countRule(2, ["a*"])])).toBe(false);
  });

  it("a tagged rule without patterns, and an untagged rule with them", () => {
    const noPatterns = { ...countRule(1, ["a*"]), selection: untagged(1).selection };
    expect(
      refused([{ ...noPatterns, selection: { ...noPatterns.selection, tagStatus: "tagged" } }]),
    ).toBe(false);
    const withPatterns = countRule(1, ["a*"]);
    expect(
      refused([
        { ...withPatterns, selection: { ...withPatterns.selection, tagStatus: "untagged" } },
      ]),
    ).toBe(false);
  });

  it("two rules for untagged images", () => {
    expect(refused([untagged(1), untagged(2)])).toBe(false);
  });

  it("five wildcards in one pattern, a zero count, and a unit on a count rule", () => {
    expect(refused([countRule(1, ["a*b*c*d*e*"])])).toBe(false);
    expect(refused([countRule(1, ["a*b*c*d*"])])).toBe(true);
    expect(refused([countRule(1, ["a*"], 0)])).toBe(false);
    const withUnit = countRule(1, ["a*"]);
    expect(
      refused([{ ...withUnit, selection: { ...withUnit.selection, countUnit: "days" } }]),
    ).toBe(false);
  });

  it("a rule form this evaluator does not implement, instead of guessing", () => {
    const base = countRule(1, ["a*"]);
    expect(
      refused([{ ...base, action: { type: "transition", targetStorageClass: "archive" } }]),
    ).toBe(false);
    expect(
      refused([{ ...base, selection: { ...base.selection, countType: "sinceImagePulled" } }]),
    ).toBe(false);
    const { tagPatternList: _dropped, ...rest } = base.selection;
    expect(refused([{ ...base, selection: { ...rest, tagPrefixList: ["a"] } }])).toBe(false);
  });
});
