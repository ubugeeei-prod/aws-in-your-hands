import type { LifecyclePolicy } from "./lifecycle.ts";

// #region tags
/** Every build is pushed once, under the commit it was built from. */
export const buildTag = (commit: string): string => `sha-${commit}`;
/** A build that went to production gets a second name. The digest does not change. */
export const releaseTag = (version: string): string => `v${version}`;
// #endregion tags

export const KEEP = { releases: 20, images: 30, untaggedDays: 1 } as const;

// #region policy
/** The lifecycle policy of this chapter's repository, in the JSON ECR stores. */
export const POLICY: LifecyclePolicy = {
  rules: [
    {
      rulePriority: 1,
      description: `keep the ${KEEP.releases} newest releases`,
      selection: {
        tagStatus: "tagged",
        tagPatternList: ["v*"],
        countType: "imageCountMoreThan",
        countNumber: KEEP.releases,
      },
      action: { type: "expire" },
    },
    {
      rulePriority: 2,
      description: "drop images that lost their tag",
      selection: {
        tagStatus: "untagged",
        countType: "sinceImagePushed",
        countUnit: "days",
        countNumber: KEEP.untaggedDays,
      },
      action: { type: "expire" },
    },
    {
      rulePriority: 3,
      description: `of everything, keep the ${KEEP.images} newest`,
      selection: { tagStatus: "any", countType: "imageCountMoreThan", countNumber: KEEP.images },
      action: { type: "expire" },
    },
  ],
};
// #endregion policy
