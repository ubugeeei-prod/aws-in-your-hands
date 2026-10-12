import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { edgeWafScope } from "../src/policies.ts";
import {
  apply,
  type Endpoint,
  enforces,
  type Observed,
  plan,
  report,
  type WafPolicy,
  type WebAcl,
} from "../src/reconcile.ts";
import { policyScopeSchema } from "../src/scope.ts";
import { ACCOUNT, distribution, organization, OU } from "./fixtures/organization.ts";

const FIRST = "AWSManagedRulesAmazonIpReputationList";
const LAST = "AWSManagedRulesKnownBadInputsRuleSet";

const policyWith = (options: Partial<WafPolicy> = {}): WafPolicy => ({
  id: "policy-edge",
  scope: v.parse(policyScopeSchema, edgeWafScope([OU.workloads])),
  first: [FIRST],
  last: [LAST],
  remediationEnabled: true,
  replaceAccountWebAcls: false,
  resourcesCleanUp: false,
  ...options,
});

const endpoint = (
  id: string,
  accountId: string,
  webAcl: WebAcl | null = null,
  tags: Record<string, string> = {},
): Endpoint => ({ ...distribution(id, accountId, tags), webAcl });
const accountOwned: WebAcl = { managedBy: null, first: [], own: ["TeamRateLimit"], last: [] };
/** What the administrator has been told: here, everything as it is right now. */
const seen = (actual: readonly Endpoint[]): Observed =>
  new Map(actual.map((item) => [item.id, item]));

// The test's own idea of "the rules are in force", written without the code under test.
const rulesInForce = (item: Endpoint) =>
  item.webAcl !== null && item.webAcl.first[0] === FIRST && item.webAcl.last.at(-1) === LAST;
const shouldBeCovered = (item: Endpoint) =>
  (item.accountId === ACCOUNT.dev || item.accountId === ACCOUNT.prod) &&
  item.tags["fms-waf"] !== "exempt";

describe("a distribution created after the policy", () => {
  const policy = policyWith();

  it("is in no report until its configuration has reached the administrator", () => {
    const actual = [endpoint("created-yesterday", ACCOUNT.prod)];
    // The member account sees an unprotected distribution. The administrator sees nothing.
    expect(report(policy, organization, new Map())).toEqual(new Map());
    expect(plan(policy, organization, new Map())).toEqual([]);
    expect(rulesInForce(actual[0] as Endpoint)).toBe(false);
  });

  it("is reported, remediated, and only then called compliant", () => {
    let actual = [endpoint("created-yesterday", ACCOUNT.prod)];
    let observed = seen(actual);
    expect(report(policy, organization, observed).get("created-yesterday")).toBe("NON_COMPLIANT");

    actual = apply(policy, actual, plan(policy, organization, observed));
    // The web ACL is on, and the report still says what it last saw.
    expect(rulesInForce(actual[0] as Endpoint)).toBe(true);
    expect(report(policy, organization, observed).get("created-yesterday")).toBe("NON_COMPLIANT");

    observed = seen(actual);
    expect(report(policy, organization, observed).get("created-yesterday")).toBe("COMPLIANT");
  });

  it("stays reported and unprotected for as long as remediation is off", () => {
    const reportOnly = policyWith({ remediationEnabled: false });
    const actual = [endpoint("created-yesterday", ACCOUNT.prod)];
    const actions = plan(reportOnly, organization, seen(actual));
    expect(actions).toEqual([]);
    expect(apply(reportOnly, actual, actions)).toEqual(actual);
    expect(report(reportOnly, organization, seen(actual)).get("created-yesterday")).toBe(
      "NON_COMPLIANT",
    );
  });
});

describe("a distribution that already has a web ACL of the account's own", () => {
  const actual = [endpoint("legacy", ACCOUNT.dev, accountOwned)];

  it("is non-compliant and left alone unless the policy may replace associations", () => {
    const policy = policyWith();
    expect(plan(policy, organization, seen(actual))).toEqual([]);
    expect(report(policy, organization, seen(actual)).get("legacy")).toBe("NON_COMPLIANT");
  });

  it("gets the managed web ACL in place of its own, and the team's rule does not come along", () => {
    const policy = policyWith({ replaceAccountWebAcls: true });
    const [after] = apply(policy, actual, plan(policy, organization, seen(actual)));
    expect(after?.webAcl).toEqual({ managedBy: policy.id, first: [FIRST], own: [], last: [LAST] });
  });
});

describe("what an account owner can still do", () => {
  const policy = policyWith();
  const managed: WebAcl = { managedBy: policy.id, first: [FIRST], own: [], last: [LAST] };

  it("adds rules between the first and last groups without leaving compliance", () => {
    const withOwn = { ...managed, own: ["TeamRateLimit"] };
    expect(enforces(policy, withOwn)).toBe(true);
  });

  it("swaps the web ACL, and the report is wrong until the change is observed", () => {
    let actual = [endpoint("site", ACCOUNT.prod, managed)];
    const before = seen(actual);
    actual = [endpoint("site", ACCOUNT.prod, accountOwned)];

    // Stale, not broken: the row was computed from a snapshot in which the rules were in force.
    expect(report(policy, organization, before).get("site")).toBe("COMPLIANT");
    expect(rulesInForce(actual[0] as Endpoint)).toBe(false);

    const after = seen(actual);
    expect(report(policy, organization, after).get("site")).toBe("NON_COMPLIANT");
  });

  it("is not compliant with another policy's web ACL, or with the groups in another order", () => {
    expect(enforces(policy, { ...managed, managedBy: "policy-other" })).toBe(false);
    expect(enforces(policy, { ...managed, first: [LAST], last: [FIRST] })).toBe(false);
    expect(enforces(policy, { ...managed, last: [] })).toBe(false);
    expect(enforces(policy, null)).toBe(false);
  });
});

describe("a distribution that leaves the scope", () => {
  const managed = (policy: WafPolicy): WebAcl => ({
    managedBy: policy.id,
    first: [FIRST],
    own: [],
    last: [LAST],
  });
  const exempted = (policy: WafPolicy) => [
    endpoint("legacy", ACCOUNT.dev, managed(policy), { "fms-waf": "exempt" }),
  ];

  it("keeps its web ACL by default, and drops out of the report", () => {
    const policy = policyWith();
    const actual = exempted(policy);
    expect(plan(policy, organization, seen(actual))).toEqual([]);
    // Neither compliant nor non-compliant: an exemption is invisible here.
    expect(report(policy, organization, seen(actual)).has("legacy")).toBe(false);
  });

  it("loses the web ACL when the policy cleans up after itself", () => {
    const policy = policyWith({ resourcesCleanUp: true });
    const actual = exempted(policy);
    const [after] = apply(policy, actual, plan(policy, organization, seen(actual)));
    expect(after?.webAcl).toBeNull();
  });

  it("never loses a web ACL the policy did not create", () => {
    const policy = policyWith({ resourcesCleanUp: true });
    const actual = [endpoint("playground", ACCOUNT.sandbox, accountOwned)];
    expect(plan(policy, organization, seen(actual))).toEqual([]);
  });
});

describe("no in-scope resource is reported compliant without the policy's rules in force", () => {
  // Deterministic: the same seed walks the same 2,000 steps every run.
  function random(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
    };
  }

  const foreign: WebAcl = { managedBy: "policy-other", first: [FIRST], own: [], last: [] };
  const lookalike: WebAcl = { managedBy: null, first: [FIRST], own: [], last: [LAST] };
  // The policy's own web ACL with a rule group gone. Whether an owner can do this was not confirmed.
  const tampered: WebAcl = { managedBy: "policy-edge", first: [FIRST], own: [], last: [] };

  it.each([
    { name: "report only", options: { remediationEnabled: false } },
    { name: "remediation", options: {} },
    { name: "remediation, replacing", options: { replaceAccountWebAcls: true } },
    {
      name: "remediation, replacing, cleaning up",
      options: { replaceAccountWebAcls: true, resourcesCleanUp: true },
    },
  ])("holds through creations, tag changes, swaps, and late observations: $name", ({ options }) => {
    const policy = policyWith(options);
    const next = random(42);
    const pick = <Item>(items: readonly Item[]): Item =>
      items[Math.floor(next() * items.length)] as Item;
    let actual: Endpoint[] = [];
    const observed = new Map<string, Endpoint>();
    let staleCompliant = 0;

    for (let step = 0; step < 2000; step += 1) {
      const roll = next();
      const target = actual.length === 0 ? undefined : pick(actual);
      const change = (to: Partial<Endpoint>) => {
        actual = actual.map((item) => (item === target ? { ...item, ...to } : item));
      };
      if (roll < 0.1 || target === undefined) {
        actual.push(endpoint(`d${actual.length}`, pick(Object.values(ACCOUNT))));
      } else if (roll < 0.25) {
        change({ webAcl: pick([accountOwned, foreign, lookalike, tampered, null]) });
      } else if (roll < 0.4) {
        change({ tags: next() < 0.5 ? { "fms-waf": "exempt" } : {} });
      } else if (roll < 0.7) {
        const current = pick(actual);
        observed.set(current.id, current);
      } else {
        actual = apply(policy, actual, plan(policy, organization, observed));
      }

      for (const [id, compliance] of report(policy, organization, observed)) {
        const snapshot = observed.get(id) as Endpoint;
        const now = actual.find((item) => item.id === id) as Endpoint;
        // Only what was seen is reported, and only what should be covered.
        expect(shouldBeCovered(snapshot)).toBe(true);
        if (compliance === "COMPLIANT") {
          expect(rulesInForce(snapshot)).toBe(true);
          expect(snapshot.webAcl?.managedBy).toBe(policy.id);
          if (snapshot === now) {
            expect(rulesInForce(now)).toBe(true);
          } else if (!rulesInForce(now)) {
            staleCompliant += 1;
          }
        }
      }
    }

    // The window exists in the model too: rows that were true when observed and are not now.
    if (policy.remediationEnabled) {
      expect(staleCompliant).toBeGreaterThan(0);
    }
  });

  it("converges for everything it may touch, once everything is observed", () => {
    const policy = policyWith({ replaceAccountWebAcls: true });
    let actual = [
      endpoint("a", ACCOUNT.dev),
      endpoint("b", ACCOUNT.prod, accountOwned),
      endpoint("c", ACCOUNT.prod, foreign),
      endpoint("d", ACCOUNT.sandbox, accountOwned),
      endpoint("e", ACCOUNT.dev, null, { "fms-waf": "exempt" }),
    ];
    actual = apply(policy, actual, plan(policy, organization, seen(actual)));
    expect(actual.filter(shouldBeCovered).map(rulesInForce)).toEqual([true, true, false]);
    expect([...report(policy, organization, seen(actual))]).toEqual([
      ["a", "COMPLIANT"],
      ["b", "COMPLIANT"],
      // Another policy's web ACL is left where it is, and so is the row.
      ["c", "NON_COMPLIANT"],
    ]);
    // Out of scope means untouched.
    expect(actual[3]?.webAcl).toEqual(accountOwned);
    expect(actual[4]?.webAcl).toBeNull();
  });
});
