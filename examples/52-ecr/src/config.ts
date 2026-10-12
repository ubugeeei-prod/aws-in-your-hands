import * as v from "valibot";

export const REGION = "ap-northeast-1";
export const ECR_STACK = "AihEcr";

/** The namespace under which images pulled through the cache appear in this registry. */
export const CACHE_PREFIX = "ecr-public";
export const CACHE_UPSTREAM = "public.ecr.aws";

// #region schema
// No wildcard may reach a trust policy: `*` or `?` here would widen who can assume the role.
const exactName = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9._/-]+$/, "letters, digits, '.', '_', '/', '-' only"),
);

export const ecrConfigSchema = v.object({
  /** `owner/repo`. Absent: the stack has no push role, and nothing outside the account can push. */
  githubRepository: v.optional(
    v.pipe(
      v.string(),
      v.regex(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/, "expected owner/repo"),
    ),
  ),
  pushBranch: v.optional(exactName, "main"),
  pullThroughCache: v.optional(v.picklist(["on", "off"]), "off"),
});
export type EcrConfig = v.InferOutput<typeof ecrConfigSchema>;

/** Parses CDK context (`-c githubRepository=...`); the message names every bad field. */
export function parseEcrConfig(input: unknown): EcrConfig {
  const result = v.safeParse(ecrConfigSchema, input);
  if (!result.success) {
    const problems = result.issues.map(
      (item) => `  ${v.getDotPath(item) ?? "(root)"}: ${item.message}`,
    );
    throw new Error(`Invalid ECR settings:\n${problems.join("\n")}`);
  }
  return result.output;
}
// #endregion schema
