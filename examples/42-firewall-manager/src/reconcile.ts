// A small model of one AWS WAF policy being reconciled across accounts: what the
// administrator's report can say, and when. It follows the documented behaviour of a policy
// that creates its own web ACLs (not one that retrofits existing ones). It is not the service.

import type { Organization } from "./org.ts";
import { type PolicyScope, type Resource, resourceInScope } from "./scope.ts";

// #region world
/** The web ACL on a resource. `managedBy` is the policy that created it, or null for the account's own. */
export type WebAcl = {
  managedBy: string | null;
  first: readonly string[];
  /** Rules the account owner added. In a managed web ACL they run between first and last. */
  own: readonly string[];
  last: readonly string[];
};

export type Endpoint = Resource & { webAcl: WebAcl | null };

export type WafPolicy = {
  id: string;
  scope: PolicyScope;
  first: readonly string[];
  last: readonly string[];
  remediationEnabled: boolean;
  /** overrideCustomerWebACLAssociation: replace a web ACL the account associated itself. */
  replaceAccountWebAcls: boolean;
  /** ResourcesCleanUp: remove protection from a resource that leaves the scope. */
  resourcesCleanUp: boolean;
};
// #endregion world

// #region enforces
const same = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((name, index) => name === right[index]);

/** The policy's rule groups are in force on this web ACL, in the policy's order. */
export function enforces(policy: WafPolicy, webAcl: WebAcl | null): boolean {
  return (
    webAcl !== null &&
    webAcl.managedBy === policy.id &&
    same(webAcl.first, policy.first) &&
    same(webAcl.last, policy.last)
  );
}
// #endregion enforces

// #region report
/**
 * What the administrator knows: the last configuration of each resource that reached it.
 * A resource created a moment ago is not in here yet, and a change made a moment ago is
 * not either.
 */
export type Observed = ReadonlyMap<string, Endpoint>;

export type Compliance = "COMPLIANT" | "NON_COMPLIANT";

/** One row per in-scope resource the administrator has seen. Nothing unseen is ever called compliant. */
export function report(
  policy: WafPolicy,
  organization: Organization,
  observed: Observed,
): Map<string, Compliance> {
  const rows = new Map<string, Compliance>();
  for (const [id, endpoint] of observed) {
    if (resourceInScope(policy.scope, organization, endpoint).inScope) {
      rows.set(id, enforces(policy, endpoint.webAcl) ? "COMPLIANT" : "NON_COMPLIANT");
    }
  }
  return rows;
}
// #endregion report

// #region plan
export type Action =
  | { kind: "associate"; resourceId: string }
  | { kind: "replace-association"; resourceId: string }
  | { kind: "disassociate"; resourceId: string };

/** What remediation would do, decided from what was observed and nothing newer. */
export function plan(policy: WafPolicy, organization: Organization, observed: Observed): Action[] {
  const actions: Action[] = [];
  for (const [id, endpoint] of observed) {
    const inScope = resourceInScope(policy.scope, organization, endpoint).inScope;
    if (!inScope) {
      // By default a resource that leaves the scope keeps the web ACL it was given.
      if (policy.resourcesCleanUp && endpoint.webAcl?.managedBy === policy.id) {
        actions.push({ kind: "disassociate", resourceId: id });
      }
      continue;
    }
    if (!policy.remediationEnabled || enforces(policy, endpoint.webAcl)) {
      continue;
    }
    if (endpoint.webAcl === null) {
      actions.push({ kind: "associate", resourceId: id });
    } else if (
      endpoint.webAcl.managedBy === policy.id ||
      // Only the account's own web ACL is replaced. One from another policy is not touched.
      (endpoint.webAcl.managedBy === null && policy.replaceAccountWebAcls)
    ) {
      actions.push({ kind: "replace-association", resourceId: id });
    }
    // Otherwise the web ACL stays where it is, and the resource stays non-compliant.
  }
  return actions;
}
// #endregion plan

// #region apply
/** Carries the actions out in the member accounts. An action for a resource that is gone does nothing. */
export function apply(
  policy: WafPolicy,
  actual: readonly Endpoint[],
  actions: readonly Action[],
): Endpoint[] {
  const managed = (own: readonly string[]): WebAcl => ({
    managedBy: policy.id,
    first: policy.first,
    own,
    last: policy.last,
  });
  return actual.map((endpoint) => {
    const action = actions.find((candidate) => candidate.resourceId === endpoint.id);
    switch (action?.kind) {
      case undefined:
        return endpoint;
      case "disassociate":
        return { ...endpoint, webAcl: null };
      case "associate":
        return { ...endpoint, webAcl: managed([]) };
      case "replace-association":
        // A different web ACL: rules the account wrote into its own one do not come along.
        return {
          ...endpoint,
          webAcl: managed(endpoint.webAcl?.managedBy === policy.id ? endpoint.webAcl.own : []),
        };
    }
  });
}
// #endregion apply
