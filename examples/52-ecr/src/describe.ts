import * as v from "valibot";

import type { Image } from "./lifecycle.ts";
import { digestSchema } from "./reference.ts";

// #region describe
// The AWS CLI prints imagePushedAt as an ISO 8601 string with an offset.
const pushedAt = v.pipe(
  v.string(),
  v.isoTimestamp(),
  v.transform((text) => new Date(text)),
);

/** The fields of `aws ecr describe-images --output json` that the lifecycle evaluator reads. */
export const describeImagesSchema = v.object({
  imageDetails: v.array(
    v.object({
      imageDigest: digestSchema,
      imageTags: v.optional(v.array(v.string()), []),
      imagePushedAt: pushedAt,
      imageSizeInBytes: v.optional(v.number()),
    }),
  ),
});

export function toImages(output: unknown): Image[] {
  return v.parse(describeImagesSchema, output).imageDetails.map((detail) => ({
    digest: detail.imageDigest,
    tags: detail.imageTags,
    pushedAt: detail.imagePushedAt,
  }));
}
// #endregion describe

/** The fields of `aws ecr get-lifecycle-policy-preview` that the comparison reads. */
export const previewSchema = v.object({
  status: v.picklist(["IN_PROGRESS", "COMPLETE", "EXPIRED", "FAILED"]),
  previewResults: v.optional(
    v.array(
      v.object({
        imageDigest: digestSchema,
        appliedRulePriority: v.number(),
        action: v.object({ type: v.picklist(["EXPIRE", "TRANSITION"]) }),
      }),
    ),
    [],
  ),
});

// #region compare
/** Digests on which this book's evaluator and ECR's preview disagree. Empty means they agree. */
export function disagreements(
  mine: { digest: string; rulePriority: number }[],
  preview: v.InferOutput<typeof previewSchema>,
): string[] {
  const local = new Map(mine.map((image) => [image.digest, image.rulePriority]));
  const remote = new Map(
    preview.previewResults
      .filter((result) => result.action.type === "EXPIRE")
      .map((result) => [result.imageDigest, result.appliedRulePriority]),
  );
  const lines: string[] = [];
  for (const digest of new Set([...local.keys(), ...remote.keys()])) {
    const here = local.get(digest);
    const there = remote.get(digest);
    if (here !== there) {
      lines.push(`${digest}: local ${here ?? "keeps"}, ECR ${there ?? "keeps"}`);
    }
  }
  return lines.toSorted();
}
// #endregion compare
