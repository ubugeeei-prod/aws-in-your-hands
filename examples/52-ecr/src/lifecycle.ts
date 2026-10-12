import * as v from "valibot";

import { matchesWildcard, wildcardCount } from "./wildcard.ts";

// The rule forms this evaluator knows: tagStatus tagged (tagPatternList), untagged
// and any; countType imageCountMoreThan and sinceImagePushed; action expire.
// Anything else in a policy is refused by the schema rather than guessed at.

// #region schema
const tagPattern = v.pipe(
  v.string(),
  v.minLength(1),
  v.check((pattern) => wildcardCount(pattern) <= 4, "at most four wildcards in one pattern"),
);

const selectionSchema = v.pipe(
  v.strictObject({
    tagStatus: v.picklist(["tagged", "untagged", "any"]),
    tagPatternList: v.optional(v.pipe(v.array(tagPattern), v.minLength(1))),
    countType: v.picklist(["imageCountMoreThan", "sinceImagePushed"]),
    countUnit: v.optional(v.literal("days")),
    countNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
  }),
  v.check(
    (selection) => (selection.tagStatus === "tagged") === (selection.tagPatternList !== undefined),
    "tagged rules need tagPatternList, and only tagged rules may have one",
  ),
  v.check(
    (selection) =>
      (selection.countType === "sinceImagePushed") === (selection.countUnit !== undefined),
    "countUnit goes with sinceImagePushed, and only with it",
  ),
);

const ruleSchema = v.strictObject({
  rulePriority: v.pipe(v.number(), v.integer(), v.minValue(1)),
  description: v.optional(v.string()),
  selection: selectionSchema,
  action: v.strictObject({ type: v.literal("expire") }),
});
export type Rule = v.InferOutput<typeof ruleSchema>;

export const lifecyclePolicySchema = v.pipe(
  v.strictObject({ rules: v.pipe(v.array(ruleSchema), v.minLength(1), v.maxLength(50)) }),
  v.check(
    ({ rules }) => new Set(rules.map((rule) => rule.rulePriority)).size === rules.length,
    "every rule needs its own rulePriority",
  ),
  v.check(({ rules }) => {
    const last = Math.max(...rules.map((rule) => rule.rulePriority));
    return rules.every((rule) => rule.selection.tagStatus !== "any" || rule.rulePriority === last);
  }, "a rule with tagStatus any must have the highest rulePriority"),
  v.check(
    ({ rules }) => rules.filter((rule) => rule.selection.tagStatus === "untagged").length <= 1,
    "only one rule may select untagged images",
  ),
);
export type LifecyclePolicy = v.InferOutput<typeof lifecyclePolicySchema>;
// #endregion schema

export type Image = { digest: string; tags: string[]; pushedAt: Date };
export type Expired = { digest: string; tags: string[]; rulePriority: number };

const DAY_MS = 86_400_000;

// #region evaluate
/** Whether the rule's tag requirements, and only those, select the image. */
function selects(rule: Rule, image: Image): boolean {
  const { tagStatus, tagPatternList = [] } = rule.selection;
  if (tagStatus === "any") {
    return true;
  }
  if (tagStatus === "untagged") {
    return image.tags.length === 0;
  }
  // Every pattern has to match some tag of the image.
  return tagPatternList.every((pattern) => image.tags.some((tag) => matchesWildcard(pattern, tag)));
}

/** The images a rule would expire if it were the only rule. */
function overLimit(rule: Rule, images: Image[], now: Date): Image[] {
  const { countType, countNumber } = rule.selection;
  if (countType === "sinceImagePushed") {
    const limit = now.getTime() - countNumber * DAY_MS;
    return images.filter((image) => image.pushedAt.getTime() < limit);
  }
  const newestFirst = images.toSorted((a, b) => b.pushedAt.getTime() - a.pushedAt.getTime());
  return newestFirst.slice(countNumber);
}

/**
 * Which images the policy would expire at `now`.
 * Every rule counts all the images it selects, but an image belongs to the first rule,
 * by priority, that selects it, and only that rule may expire it.
 */
export function evaluate(policy: LifecyclePolicy, images: Image[], now: Date): Expired[] {
  const rules = policy.rules.toSorted((a, b) => a.rulePriority - b.rulePriority);
  const owner = (image: Image) => rules.find((rule) => selects(rule, image))?.rulePriority;

  return rules.flatMap((rule) =>
    overLimit(
      rule,
      images.filter((image) => selects(rule, image)),
      now,
    )
      .filter((image) => owner(image) === rule.rulePriority)
      .map(({ digest, tags }) => ({ digest, tags, rulePriority: rule.rulePriority })),
  );
}
// #endregion evaluate

// #region in-use
/** Images the policy would delete although something still names them by digest. */
export function expiredInUse(expired: Expired[], inUse: Iterable<string>): Expired[] {
  const running = new Set(inUse);
  return expired.filter((image) => running.has(image.digest));
}
// #endregion in-use
