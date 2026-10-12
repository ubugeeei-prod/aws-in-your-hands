import * as v from "valibot";

// #region policy
/** The two calls that hand out a data key. Both must carry an attestation document. */
export const ATTESTED_ACTIONS = ["kms:Decrypt", "kms:GenerateDataKey"] as const;

/** Managing the key, and nothing that uses it. No wildcard: `kms:*` would include Decrypt. */
export const ADMIN_ACTIONS = [
  "kms:CancelKeyDeletion",
  "kms:DescribeKey",
  "kms:DisableKey",
  "kms:DisableKeyRotation",
  "kms:EnableKey",
  "kms:EnableKeyRotation",
  "kms:GetKeyPolicy",
  "kms:GetKeyRotationStatus",
  "kms:ListResourceTags",
  "kms:PutKeyPolicy",
  "kms:ScheduleKeyDeletion",
  "kms:TagResource",
  "kms:UntagResource",
  "kms:UpdateKeyDescription",
] as const;

export const IMAGE_SHA384 = "kms:RecipientAttestation:ImageSha384";

export type Statement<Principal> = {
  Sid: string;
  Effect: "Allow";
  Principal: { AWS: Principal };
  Action: string[];
  Resource: "*";
  Condition?: { StringEqualsIgnoreCase: Record<string, string> };
};
export type KeyPolicy<Principal> = { Version: "2012-10-17"; Statement: Statement<Principal>[] };

/**
 * The whole key policy. `Principal` is a string in the tests and a CloudFormation
 * reference in the stack: one function writes both, so they cannot drift apart.
 */
export function keyPolicy<Principal>(input: {
  accountRoot: Principal;
  enclaveRole: Principal;
  measurement: string | undefined;
}): KeyPolicy<Principal> {
  const statements: Statement<Principal>[] = [
    {
      Sid: "AdministerWithoutUsing",
      Effect: "Allow",
      Principal: { AWS: input.accountRoot },
      Action: [...ADMIN_ACTIONS],
      Resource: "*",
    },
  ];
  // No measurement, no statement: a key nobody can use is the safe starting point.
  if (input.measurement !== undefined) {
    statements.push({
      Sid: "UseOnlyFromTheMeasuredEnclave",
      Effect: "Allow",
      Principal: { AWS: input.enclaveRole },
      Action: [...ATTESTED_ACTIONS],
      Resource: "*",
      Condition: { StringEqualsIgnoreCase: { [IMAGE_SHA384]: input.measurement } },
    });
  }
  return { Version: "2012-10-17", Statement: statements };
}
// #endregion policy

// #region schema
// A principal that is not a string is a CloudFormation reference. Its JSON text stands for it.
const principal = v.pipe(
  v.unknown(),
  v.transform((value) => (typeof value === "string" ? value : JSON.stringify(value))),
);
const oneOrMany = <Item extends v.GenericSchema>(item: Item) =>
  v.pipe(
    v.union([v.array(item), item]),
    v.transform((value) => (Array.isArray(value) ? value : [value])),
  );
const noWildcard = v.check(
  (value: string) => !value.includes("*"),
  "wildcards are outside this model",
);

const policySchema = v.object({
  Statement: v.array(
    v.object({
      Sid: v.optional(v.string()),
      Effect: v.picklist(["Allow", "Deny"]),
      Principal: v.strictObject({ AWS: oneOrMany(v.pipe(principal, noWildcard)) }),
      Action: oneOrMany(v.pipe(v.string(), noWildcard)),
      Resource: v.literal("*"),
      // strictObject: any other operator is refused, not skipped.
      Condition: v.optional(
        v.strictObject({ StringEqualsIgnoreCase: v.record(v.string(), v.string()) }),
      ),
    }),
  ),
});
// #endregion schema

// #region evaluate
/** One KMS call as the model sees it. `attestedPcrs` exists only when the document was valid. */
export type KmsCall = {
  principal: string;
  action: string;
  attestedPcrs?: Record<number, string>;
};
export type Decision = { allowed: boolean; because: string };

/** The PCR a condition key reads. ImageSha384 is another name for PCR0. */
function pcrIndex(conditionKey: string): number {
  if (conditionKey === IMAGE_SHA384) {
    return 0;
  }
  const match = /^kms:RecipientAttestation:PCR(\d{1,2})$/.exec(conditionKey);
  if (match === null) {
    throw new Error(`condition key "${conditionKey}" is outside this model`);
  }
  return Number(match[1]);
}

/**
 * This book's model of how KMS reads a key policy, for exactly these forms: Allow and
 * Deny, principals and actions named in full, Resource "*", and StringEqualsIgnoreCase
 * on the two attestation condition keys. It knows no IAM policies, grants, or SCPs.
 * Anything else in the policy throws instead of being read as "no restriction".
 */
export function evaluate(policy: unknown, call: KmsCall): Decision {
  const matching = v.parse(policySchema, policy).Statement.filter((statement) => {
    const conditions = Object.entries(statement.Condition?.StringEqualsIgnoreCase ?? {}).map(
      ([key, expected]) => ({ index: pcrIndex(key), expected }),
    );
    return (
      statement.Principal.AWS.includes(call.principal) &&
      statement.Action.includes(call.action) &&
      // Without an attestation document the key is absent, and an absent key matches nothing.
      conditions.every(
        ({ index, expected }) =>
          call.attestedPcrs?.[index]?.toLowerCase() === expected.toLowerCase(),
      )
    );
  });
  const denied = matching.find((statement) => statement.Effect === "Deny");
  if (denied !== undefined) {
    return { allowed: false, because: `explicit deny (${denied.Sid ?? "no Sid"})` };
  }
  const [allowed] = matching;
  return allowed === undefined
    ? { allowed: false, because: "no statement allows this call" }
    : { allowed: true, because: `allowed by ${allowed.Sid ?? "a statement without Sid"}` };
}
// #endregion evaluate
