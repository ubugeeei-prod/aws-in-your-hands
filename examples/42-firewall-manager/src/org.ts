import * as v from "valibot";

// #region organization
const accountId = v.pipe(v.string(), v.regex(/^\d{12}$/, "must be a 12-digit account ID"));
// The pattern of OrganizationalUnit.Id in the Organizations API reference.
const orgUnitId = v.pipe(
  v.string(),
  v.regex(/^ou-[0-9a-z]{4,32}-[a-z0-9]{8,32}$/, "must be an OU ID such as ou-ab12-cdefgh34"),
);

export const organizationSchema = v.object({
  /** `parentId: null` is an OU directly under the root. */
  orgUnits: v.array(v.object({ id: orgUnitId, parentId: v.nullable(orgUnitId) })),
  /** `orgUnitId: null` is an account directly under the root. */
  accounts: v.array(v.object({ id: accountId, orgUnitId: v.nullable(orgUnitId) })),
});
export type Organization = v.InferOutput<typeof organizationSchema>;

export { accountId as accountIdSchema, orgUnitId as orgUnitIdSchema };
// #endregion organization

// #region ancestry
/**
 * The OUs an account is in, innermost first. Naming an OU in a policy names every account
 * in it and in its child OUs, so membership is a walk up the tree.
 */
export function orgUnitsOf(organization: Organization, account: string): string[] {
  const start = organization.accounts.find((candidate) => candidate.id === account);
  if (start === undefined) {
    throw new Error(`Account ${account} is not in the organization`);
  }
  const parents = new Map(organization.orgUnits.map((unit) => [unit.id, unit.parentId]));
  const path: string[] = [];
  let current = start.orgUnitId;
  while (current !== null) {
    if (path.includes(current) || !parents.has(current)) {
      // A fixture that loops or points nowhere is a mistake in the fixture, not a scope answer.
      throw new Error(`OU ${current} is missing or part of a cycle`);
    }
    path.push(current);
    current = parents.get(current) ?? null;
  }
  return path;
}
// #endregion ancestry
