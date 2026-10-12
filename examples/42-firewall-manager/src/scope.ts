// A model of how the Firewall Manager documentation describes policy scope. It is this
// chapter's reading of the documented rules, run on a laptop. It is not the service.

import * as v from "valibot";

import { accountIdSchema, type Organization, orgUnitIdSchema, orgUnitsOf } from "./org.ts";

// #region scope-schema
const ieMap = v.pipe(
  v.strictObject({
    accounts: v.optional(v.array(accountIdSchema), []),
    orgUnits: v.optional(v.array(orgUnitIdSchema), []),
  }),
  // What an empty map means is not documented, so this model refuses to guess.
  v.check((map) => map.accounts.length + map.orgUnits.length > 0, "must name an account or an OU"),
);

const resourceTag = v.strictObject({
  key: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
  // "Every resource tag must have a string value": an omitted value is saved as "".
  value: v.optional(v.pipe(v.string(), v.maxLength(256)), ""),
});

/** The quotas page, read 2026-10-13: 8 tags and 20 OUs per policy by default. */
export const MAX_SCOPE_TAGS = 8;
export const MAX_SCOPE_ORG_UNITS = 20;

export const policyScopeSchema = v.pipe(
  v.strictObject({
    includeMap: v.optional(ieMap),
    excludeMap: v.optional(ieMap),
    resourceTypes: v.pipe(v.array(v.pipe(v.string(), v.regex(/^AWS::\w+::\w+$/))), v.minLength(1)),
    resourceTags: v.optional(v.pipe(v.array(resourceTag), v.maxLength(MAX_SCOPE_TAGS)), []),
    excludeResourceTags: v.boolean(),
    resourceTagLogicalOperator: v.optional(v.picklist(["AND", "OR"]), "AND"),
  }),
  v.check(
    (scope) =>
      (scope.includeMap?.orgUnits.length ?? 0) <= MAX_SCOPE_ORG_UNITS &&
      (scope.excludeMap?.orgUnits.length ?? 0) <= MAX_SCOPE_ORG_UNITS,
    `names more than ${MAX_SCOPE_ORG_UNITS} OUs`,
  ),
);
export type PolicyScope = v.InferOutput<typeof policyScopeSchema>;
export type PolicyScopeInput = v.InferInput<typeof policyScopeSchema>;
// #endregion scope-schema

export type Resource = {
  id: string;
  accountId: string;
  /** A CloudFormation resource type, as Policy.ResourceType is written. */
  type: string;
  tags: Readonly<Record<string, string>>;
};

// #region accounts
/**
 * "If you specify an IncludeMap, Firewall Manager applies the policy to all accounts
 * specified by the IncludeMap, and does not evaluate any ExcludeMap specifications."
 */
export function accountInScope(
  scope: PolicyScope,
  organization: Organization,
  account: string,
): boolean {
  const orgUnits = orgUnitsOf(organization, account);
  const named = (map: NonNullable<PolicyScope["includeMap"]>) =>
    map.accounts.includes(account) || map.orgUnits.some((unit) => orgUnits.includes(unit));
  if (scope.includeMap !== undefined) {
    return named(scope.includeMap);
  }
  return scope.excludeMap === undefined || !named(scope.excludeMap);
}
// #endregion accounts

// #region tags
/** A tag matches only on the same key and the same value; "" matches only "". */
export function tagsMatch(scope: PolicyScope, tags: Readonly<Record<string, string>>): boolean {
  const has = (tag: { key: string; value: string }) =>
    Object.hasOwn(tags, tag.key) && tags[tag.key] === tag.value;
  return scope.resourceTagLogicalOperator === "AND"
    ? scope.resourceTags.every(has)
    : scope.resourceTags.some(has);
}
// #endregion tags

// #region resource
export type ScopeAnswer =
  | { inScope: true }
  // `tags` is the one an account owner can cause by tagging: the exception, or a typo.
  | { inScope: false; because: "account" | "type" | "tags" };

export function resourceInScope(
  scope: PolicyScope,
  organization: Organization,
  resource: Resource,
): ScopeAnswer {
  if (!accountInScope(scope, organization, resource.accountId)) {
    return { inScope: false, because: "account" };
  }
  if (!scope.resourceTypes.includes(resource.type)) {
    return { inScope: false, because: "type" };
  }
  // Without tags in the policy, tags do not change the scope.
  if (scope.resourceTags.length === 0) {
    return { inScope: true };
  }
  const matched = tagsMatch(scope, resource.tags);
  return matched === scope.excludeResourceTags
    ? { inScope: false, because: "tags" }
    : { inScope: true };
}
// #endregion resource

// #region coverage
export type Coverage = {
  covered: Resource[];
  /** Right account, right type, kept out by tags alone. With an exclusion policy: the exceptions. */
  keptOutByTags: Resource[];
  elsewhere: Resource[];
};

export function coverage(
  scope: PolicyScope,
  organization: Organization,
  resources: readonly Resource[],
): Coverage {
  const result: Coverage = { covered: [], keptOutByTags: [], elsewhere: [] };
  for (const resource of resources) {
    const answer = resourceInScope(scope, organization, resource);
    if (answer.inScope) {
      result.covered.push(resource);
    } else if (answer.because === "tags") {
      result.keptOutByTags.push(resource);
    } else {
      result.elsewhere.push(resource);
    }
  }
  return result;
}
// #endregion coverage
