import * as v from "valibot";

import { accountIdSchema, orgUnitIdSchema } from "../../src/org.ts";
import { MAX_SCOPE_ORG_UNITS } from "../../src/scope.ts";

/** A policy for CloudFront distributions is created in the Region the console calls Global. */
export const GLOBAL_REGION = "us-east-1";

// #region context
const onOff = v.optional(v.picklist(["on", "off"]), "off");

export const firewallConfigSchema = v.object({
  // No default for these two. A policy scoped to somebody else's example IDs must not synthesize.
  /** The Firewall Manager administrator account: the one these stacks are deployed into. */
  adminAccountId: v.pipe(
    v.string("is required: -c adminAccountId=<12 digits, as text>"),
    accountIdSchema,
  ),
  /** The OUs both policies cover, separated by commas. Child OUs are covered with them. */
  orgUnitIds: v.pipe(
    v.string("is required: -c orgUnitIds=<ou-...>[,<ou-...>]"),
    v.transform((text) => text.split(",").map((part) => part.trim())),
    v.array(orgUnitIdSchema),
    v.minLength(1),
    v.maxLength(MAX_SCOPE_ORG_UNITS),
  ),
  /** off: report only. on: associate the managed web ACL with every distribution in scope. */
  wafRemediation: onOff,
  /** on: with remediation, also replace a web ACL an account had associated itself. */
  replaceAccountWebAcls: onOff,
  /** off: report only. on: update or remove non-compliant inbound rules. Off at creation, always. */
  sgRemediation: onOff,
  /** Subscribes this address to the compliance topic. The owner has to confirm by email. */
  notifyEmail: v.optional(v.pipe(v.string(), v.email())),
});
export type FirewallConfig = v.InferOutput<typeof firewallConfigSchema>;

export function parseFirewallConfig(context: (key: string) => unknown): FirewallConfig {
  const result = v.safeParse(firewallConfigSchema, {
    adminAccountId: context("adminAccountId"),
    orgUnitIds: context("orgUnitIds"),
    wafRemediation: context("wafRemediation"),
    replaceAccountWebAcls: context("replaceAccountWebAcls"),
    sgRemediation: context("sgRemediation"),
    notifyEmail: context("notifyEmail"),
  });
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid CDK context:\n  ${problems.join("\n  ")}`);
  }
  if (result.output.replaceAccountWebAcls === "on" && result.output.wafRemediation === "off") {
    throw new Error("Invalid CDK context:\n  replaceAccountWebAcls=on needs wafRemediation=on");
  }
  return result.output;
}
// #endregion context
