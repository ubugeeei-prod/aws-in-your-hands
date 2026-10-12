import { CfnOutput, Stack, type StackProps, Token } from "aws-cdk-lib";
import * as fms from "aws-cdk-lib/aws-fms";
import type { Construct } from "constructs";

import { encode, wafV2DataSchema } from "../../src/managed-service-data.ts";
import { EDGE_WAF_POLICY_NAME, edgeWafData, edgeWafScope } from "../../src/policies.ts";
import { GLOBAL_REGION } from "./config.ts";
import { scopeProps } from "./scope-props.ts";

export type EdgeWafPolicyStackProps = StackProps & {
  orgUnitIds: string[];
  remediation: boolean;
  replaceAccountWebAcls: boolean;
};

/** One AWS WAF policy for every CloudFront distribution in the named OUs. Billed by the month. */
export class EdgeWafPolicyStack extends Stack {
  constructor(scope: Construct, id: string, props: EdgeWafPolicyStackProps) {
    super(scope, id, props);
    if (Token.isUnresolved(this.region) || this.region !== GLOBAL_REGION) {
      throw new Error(
        `A policy for CloudFront distributions must be created in ${GLOBAL_REGION}, not ${this.region}.`,
      );
    }

    // #region waf-policy
    const policy = new fms.CfnPolicy(this, "EdgeWafPolicy", {
      policyName: EDGE_WAF_POLICY_NAME,
      policyDescription:
        "AWS in Your Hands chapter 42: IP reputation first and known bad inputs last on every CloudFront distribution",
      ...scopeProps(edgeWafScope(props.orgUnitIds)),
      securityServicePolicyData: {
        type: "WAFV2",
        managedServiceData: encode(
          wafV2DataSchema,
          edgeWafData({ replaceAccountWebAcls: props.replaceAccountWebAcls }),
        ),
      },
      // false: accounts and resources out of compliance are listed, and nothing is changed.
      remediationEnabled: props.remediation,
      // A distribution that leaves the scope loses the managed web ACL instead of keeping it unseen.
      resourcesCleanUp: true,
      // A practice policy: deleting it also removes the web ACLs it created in member accounts.
      deleteAllPolicyResources: true,
    });
    // #endregion waf-policy

    new CfnOutput(this, "EdgeWafPolicyId", { value: policy.attrId });
  }
}
