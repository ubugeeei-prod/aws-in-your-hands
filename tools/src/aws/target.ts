// Decided before any AWS call, so a wrong profile is caught before a deploy.

export const DEFAULT_REGION = "ap-northeast-1";

export type Target = {
  region: string;
  /** From AIH_AWS_ACCOUNT_ID. Required to change AWS. */
  expectedAccountId: string | undefined;
};

export type Identity = { accountId: string; arn: string };

export type Access = "observe" | "mutate";

export type TargetCheck = { ok: true } | { ok: false; reason: string };

const ACCOUNT_ID = /^\d{12}$/;

export function resolveTarget(env: Record<string, string | undefined>): Target {
  const region = env["AIH_AWS_REGION"] ?? DEFAULT_REGION;
  const expectedAccountId = env["AIH_AWS_ACCOUNT_ID"];
  if (expectedAccountId !== undefined && !ACCOUNT_ID.test(expectedAccountId)) {
    throw new Error(`AIH_AWS_ACCOUNT_ID must be a 12-digit account ID, got "${expectedAccountId}"`);
  }
  return { region, expectedAccountId };
}

// #region check
export function checkTarget(target: Target, identity: Identity, access: Access): TargetCheck {
  if (target.expectedAccountId === undefined) {
    return access === "mutate"
      ? {
          ok: false,
          reason:
            "AIH_AWS_ACCOUNT_ID is not set. Tasks that change AWS refuse to run until you name the account " +
            `they may change. The current credentials belong to ${identity.accountId}; if that is the ` +
            "intended account, put AIH_AWS_ACCOUNT_ID in .env (see .env.example).",
        }
      : { ok: true };
  }
  return target.expectedAccountId === identity.accountId
    ? { ok: true }
    : {
        ok: false,
        reason: `Credentials belong to account ${identity.accountId}, but AIH_AWS_ACCOUNT_ID is ${target.expectedAccountId}.`,
      };
}
// #endregion check
