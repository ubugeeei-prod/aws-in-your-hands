import * as v from "valibot";

import { type PolicyScopeInput, policyScopeSchema } from "../../src/scope.ts";

// #region scope-props
type IeMap = { account?: string[]; orgunit?: string[] };

const ieMap = (map: { accounts: string[]; orgUnits: string[] }): IeMap => ({
  ...(map.accounts.length > 0 ? { account: map.accounts } : {}),
  ...(map.orgUnits.length > 0 ? { orgunit: map.orgUnits } : {}),
});

/** The scope the local evaluator reads, as the properties of AWS::FMS::Policy. */
export function scopeProps(input: PolicyScopeInput) {
  const scope = v.parse(policyScopeSchema, input);
  if (scope.includeMap !== undefined && scope.excludeMap !== undefined) {
    // The service would ignore the ExcludeMap. A stack that states both states something untrue.
    throw new Error("A policy names accounts to include or to exclude, not both");
  }
  const [firstType = "", ...moreTypes] = scope.resourceTypes;
  return {
    ...(scope.includeMap === undefined ? {} : { includeMap: ieMap(scope.includeMap) }),
    ...(scope.excludeMap === undefined ? {} : { excludeMap: ieMap(scope.excludeMap) }),
    ...(moreTypes.length === 0
      ? { resourceType: firstType }
      : { resourceType: "ResourceTypeList", resourceTypeList: scope.resourceTypes }),
    resourceTags: scope.resourceTags.map((tag) => ({ key: tag.key, value: tag.value })),
    excludeResourceTags: scope.excludeResourceTags,
    resourceTagLogicalOperator: scope.resourceTagLogicalOperator,
  };
}
// #endregion scope-props
