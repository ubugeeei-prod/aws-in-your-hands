import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { orgUnitsOf } from "../src/org.ts";
import { edgeWafScope, WAF_EXEMPT_TAG } from "../src/policies.ts";
import {
  accountInScope,
  coverage,
  type PolicyScopeInput,
  policyScopeSchema,
  resourceInScope,
  tagsMatch,
} from "../src/scope.ts";
import { ACCOUNT, distribution, organization, OU } from "./fixtures/organization.ts";

const scopeOf = (input: PolicyScopeInput) => v.parse(policyScopeSchema, input);
const allDistributions: PolicyScopeInput = {
  resourceTypes: ["AWS::CloudFront::Distribution"],
  excludeResourceTags: false,
};
const accountsIn = (input: PolicyScopeInput) =>
  Object.entries(ACCOUNT)
    .filter(([, id]) => accountInScope(scopeOf(input), organization, id))
    .map(([name]) => name);

describe("accounts in scope", () => {
  it("covers every account of the organization when no map is given", () => {
    // "All accounts" is taken literally here, the management account included.
    expect(accountsIn(allDistributions)).toEqual([
      "management",
      "security",
      "dev",
      "prod",
      "sandbox",
    ]);
  });

  it("reaches the accounts of child OUs through the OU that was named", () => {
    expect(orgUnitsOf(organization, ACCOUNT.prod)).toEqual([OU.production, OU.workloads]);
    expect(accountsIn({ ...allDistributions, includeMap: { orgUnits: [OU.workloads] } })).toEqual([
      "dev",
      "prod",
    ]);
  });

  it("excludes the named accounts and OUs, and nothing else", () => {
    expect(
      accountsIn({
        ...allDistributions,
        excludeMap: { accounts: [ACCOUNT.security], orgUnits: [OU.sandbox] },
      }),
    ).toEqual(["management", "dev", "prod"]);
  });

  it("does not evaluate the exclude map once an include map exists", () => {
    // As documented. Excluding `prod` here does nothing, which is why the stack refuses both.
    expect(
      accountsIn({
        ...allDistributions,
        includeMap: { orgUnits: [OU.workloads] },
        excludeMap: { accounts: [ACCOUNT.prod] },
      }),
    ).toEqual(["dev", "prod"]);
  });

  it("takes in an account that joins a named OU, and not one beside a named account", () => {
    const joined = {
      ...organization,
      accounts: [...organization.accounts, { id: "666666666666", orgUnitId: OU.production }],
    };
    const byOu = scopeOf({ ...allDistributions, includeMap: { orgUnits: [OU.workloads] } });
    const byAccount = scopeOf({ ...allDistributions, includeMap: { accounts: [ACCOUNT.prod] } });
    expect(accountInScope(byOu, joined, "666666666666")).toBe(true);
    expect(accountInScope(byAccount, joined, "666666666666")).toBe(false);
  });

  it("refuses to answer for an account outside the organization", () => {
    expect(() => accountInScope(scopeOf(allDistributions), organization, "999999999999")).toThrow(
      /not in the organization/,
    );
  });
});

describe("tags", () => {
  const tags = [
    { key: "tier", value: "public" },
    { key: "team", value: "notes" },
  ];
  const withTags = (operator: "AND" | "OR", exclude: boolean) =>
    scopeOf({
      ...allDistributions,
      resourceTags: tags,
      resourceTagLogicalOperator: operator,
      excludeResourceTags: exclude,
    });
  const inScope = (scope: ReturnType<typeof scopeOf>, resourceTags: Record<string, string>) =>
    resourceInScope(scope, organization, distribution("d", ACCOUNT.dev, resourceTags)).inScope;

  const both = { tier: "public", team: "notes" };
  const one = { tier: "public" };
  const none = {};

  it("includes only resources with all of the tags, under AND", () => {
    const scope = withTags("AND", false);
    expect([both, one, none].map((given) => inScope(scope, given))).toEqual([true, false, false]);
  });

  it("includes resources with any of the tags, under OR", () => {
    const scope = withTags("OR", false);
    expect([both, one, none].map((given) => inScope(scope, given))).toEqual([true, true, false]);
  });

  it("excludes only resources with all of the tags, under AND", () => {
    const scope = withTags("AND", true);
    expect([both, one, none].map((given) => inScope(scope, given))).toEqual([false, true, true]);
  });

  it("excludes resources with any of the tags, under OR", () => {
    const scope = withTags("OR", true);
    expect([both, one, none].map((given) => inScope(scope, given))).toEqual([false, false, true]);
  });

  it("matches on key and value together", () => {
    const scope = scopeOf({ ...allDistributions, resourceTags: [WAF_EXEMPT_TAG] });
    expect(tagsMatch(scope, { "fms-waf": "exempt" })).toBe(true);
    expect(tagsMatch(scope, { "fms-waf": "Exempt" })).toBe(false);
    expect(tagsMatch(scope, { "fms-waf": "" })).toBe(false);
    expect(tagsMatch(scope, { "FMS-WAF": "exempt" })).toBe(false);
  });

  it("saves a tag without a value as the empty string, which matches only the empty string", () => {
    const scope = scopeOf({ ...allDistributions, resourceTags: [{ key: "public" }] });
    expect(scope.resourceTags).toEqual([{ key: "public", value: "" }]);
    expect(tagsMatch(scope, { public: "" })).toBe(true);
    expect(tagsMatch(scope, { public: "yes" })).toBe(false);
  });

  it("leaves the scope alone when the policy has no tags, whatever ExcludeResourceTags says", () => {
    for (const excludeResourceTags of [true, false]) {
      const scope = scopeOf({ ...allDistributions, excludeResourceTags });
      expect(inScope(scope, both)).toBe(true);
    }
  });
});

describe("this chapter's AWS WAF policy", () => {
  const scope = scopeOf(edgeWafScope([OU.workloads]));

  it("covers a distribution nobody tagged, such as the one created yesterday", () => {
    const created = distribution("new", ACCOUNT.prod);
    expect(resourceInScope(scope, organization, created)).toEqual({ inScope: true });
  });

  it("lets a resource out by the exemption tag, and reports that it was the tag", () => {
    const before = distribution("legacy", ACCOUNT.dev);
    const after = { ...before, tags: { "fms-waf": "exempt" } };
    expect(resourceInScope(scope, organization, before).inScope).toBe(true);
    expect(resourceInScope(scope, organization, after)).toEqual({
      inScope: false,
      because: "tags",
    });
  });

  it("separates the exemptions from what was never in scope", () => {
    const result = coverage(scope, organization, [
      distribution("site", ACCOUNT.prod),
      distribution("legacy", ACCOUNT.dev, { "fms-waf": "exempt" }),
      distribution("playground", ACCOUNT.sandbox),
      {
        id: "alb",
        accountId: ACCOUNT.prod,
        type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
        tags: {},
      },
    ]);
    expect(result.covered.map((resource) => resource.id)).toEqual(["site"]);
    expect(result.keptOutByTags.map((resource) => resource.id)).toEqual(["legacy"]);
    expect(result.elsewhere.map((resource) => resource.id)).toEqual(["playground", "alb"]);
  });
});

describe("the scope a policy may state", () => {
  const refuses = (input: unknown) => !v.safeParse(policyScopeSchema, input).success;

  it("stops at the documented default quotas of 8 tags and 20 OUs", () => {
    const tags = Array.from({ length: 9 }, (_, index) => ({ key: `k${index}`, value: "v" }));
    const units = Array.from(
      { length: 21 },
      (_, index) => `ou-ex42-${String(index).padStart(8, "0")}`,
    );
    expect(refuses({ ...allDistributions, resourceTags: tags })).toBe(true);
    expect(refuses({ ...allDistributions, resourceTags: tags.slice(0, 8) })).toBe(false);
    expect(refuses({ ...allDistributions, includeMap: { orgUnits: units } })).toBe(true);
    expect(refuses({ ...allDistributions, includeMap: { orgUnits: units.slice(0, 20) } })).toBe(
      false,
    );
  });

  it("refuses a map that names nothing, a misspelled key, and an ID of the wrong shape", () => {
    expect(refuses({ ...allDistributions, includeMap: {} })).toBe(true);
    expect(refuses({ ...allDistributions, includeMap: { orgunits: [OU.workloads] } })).toBe(true);
    expect(refuses({ ...allDistributions, includeMap: { accounts: ["12345"] } })).toBe(true);
    expect(refuses({ ...allDistributions, includeMap: { orgUnits: ["workloads"] } })).toBe(true);
    expect(refuses({ ...allDistributions, resourceTypes: [] })).toBe(true);
  });
});
