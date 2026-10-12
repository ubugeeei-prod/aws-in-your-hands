// #region profile
/**
 * Where the Standard tier of a guardrail may evaluate text for a caller in ap-northeast-1,
 * read off "Supported Regions for cross-Region guardrail inference" on 2026-10-13. Unlike
 * the `jp.` model profile, this list leaves Japan.
 */
export const APAC_GUARDRAIL_PROFILE = {
  id: "apac.guardrail.v1:0",
  destinations: [
    "ap-south-1",
    "ap-northeast-3",
    "ap-northeast-2",
    "ap-southeast-1",
    "ap-southeast-2",
    "ap-northeast-1",
  ],
} as const;

export const promptAttackFilters = ["off", "standard"] as const;
export type PromptAttackFilter = (typeof promptAttackFilters)[number];

export function isPromptAttackFilter(value: string): value is PromptAttackFilter {
  return (promptAttackFilters as readonly string[]).includes(value);
}

/** The guardrail profile in every Region it may route to: IAM has to allow each one. */
export function guardrailProfileArns(scope: { partition: string; account: string }): string[] {
  return APAC_GUARDRAIL_PROFILE.destinations.map(
    (region) =>
      `arn:${scope.partition}:bedrock:${region}:${scope.account}:guardrail-profile/${APAC_GUARDRAIL_PROFILE.id}`,
  );
}
// #endregion profile
