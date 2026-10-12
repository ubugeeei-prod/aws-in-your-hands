// Written for these tests. No such organization exists: the account IDs are repeated
// digits and the OU IDs only follow the pattern the Organizations API documents.

import type { Organization } from "../../src/org.ts";
import type { Resource } from "../../src/scope.ts";

export const OU = {
  workloads: "ou-ex42-workload1",
  production: "ou-ex42-prodprod",
  sandbox: "ou-ex42-sandbox1",
  security: "ou-ex42-security",
} as const;

export const ACCOUNT = {
  management: "111111111111",
  /** The Firewall Manager administrator account. */
  security: "222222222222",
  dev: "333333333333",
  prod: "444444444444",
  sandbox: "555555555555",
} as const;

export const organization: Organization = {
  orgUnits: [
    { id: OU.workloads, parentId: null },
    // A child OU: naming `workloads` in a policy names `production` too.
    { id: OU.production, parentId: OU.workloads },
    { id: OU.sandbox, parentId: null },
    { id: OU.security, parentId: null },
  ],
  accounts: [
    { id: ACCOUNT.management, orgUnitId: null },
    { id: ACCOUNT.security, orgUnitId: OU.security },
    { id: ACCOUNT.dev, orgUnitId: OU.workloads },
    { id: ACCOUNT.prod, orgUnitId: OU.production },
    { id: ACCOUNT.sandbox, orgUnitId: OU.sandbox },
  ],
};

export const distribution = (
  id: string,
  accountId: string,
  tags: Record<string, string> = {},
): Resource => ({ id, accountId, type: "AWS::CloudFront::Distribution", tags });
