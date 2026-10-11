// #region models
/**
 * Inference profiles that were read off their model card on 2026-10-11 as
 * callable from ap-northeast-1. A profile sends the request to one of its
 * destination Regions; IAM has to allow the model in every one of them.
 */
export const verifiedProfiles = {
  // Amazon model: no AWS Marketplace subscription, no use case form.
  "jp.amazon.nova-2-lite-v1:0": {
    model: "amazon.nova-2-lite-v1:0",
    destinations: ["ap-northeast-1", "ap-northeast-3"],
  },
  // Any commercial Region. The list of Regions can grow, so IAM gets the Region-less ARN.
  "global.amazon.nova-2-lite-v1:0": {
    model: "amazon.nova-2-lite-v1:0",
    destinations: "global",
  },
  // Anthropic model: needs the one-time use case form and a Marketplace subscription.
  "jp.anthropic.claude-haiku-4-5-20251001-v1:0": {
    model: "anthropic.claude-haiku-4-5-20251001-v1:0",
    destinations: ["ap-northeast-1", "ap-northeast-3"],
  },
} as const satisfies Record<string, { model: string; destinations: readonly string[] | "global" }>;

export type VerifiedProfileId = keyof typeof verifiedProfiles;
export const defaultProfileId: VerifiedProfileId = "jp.amazon.nova-2-lite-v1:0";

export function isVerifiedProfileId(value: string): value is VerifiedProfileId {
  return Object.hasOwn(verifiedProfiles, value);
}
// #endregion models

// #region arns
export type ModelArns = { profileArn: string; modelArns: string[] };

/** The ARNs one inference profile needs, for a caller in `region` of `account`. */
export function modelArns(
  profileId: VerifiedProfileId,
  scope: { partition: string; region: string; account: string },
): ModelArns {
  const profile = verifiedProfiles[profileId];
  const model = (region: string) => `arn:${scope.partition}:bedrock:${region}::foundation-model/${profile.model}`;
  return {
    profileArn: `arn:${scope.partition}:bedrock:${scope.region}:${scope.account}:inference-profile/${profileId}`,
    modelArns:
      profile.destinations === "global"
        ? // The form the user guide gives for a global profile: the source Region, and no Region.
          [model(scope.region), model("")]
        : profile.destinations.map(model),
  };
}
// #endregion arns
