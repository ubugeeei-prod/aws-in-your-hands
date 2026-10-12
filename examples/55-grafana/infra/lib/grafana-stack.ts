import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import * as grafana from "aws-cdk-lib/aws-grafana";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

export type Authentication = "AWS_SSO" | "SAML";

export type GrafanaStackProps = StackProps & {
  /**
   * How people sign in. Giving it creates the workspace, which is billed from then on.
   * Without it the stack holds the role only, which costs nothing.
   */
  authentication?: Authentication | undefined;
  /** Managed prefix lists whose addresses may reach the workspace. Without any, every address may. */
  prefixListIds?: readonly string[] | undefined;
  /** Left out, the service picks its latest version. */
  grafanaVersion?: string | undefined;
};

// #region actions
// What the CloudWatch data source needs to draw the panels of this chapter. Logs, alarms,
// EC2 tags and cross-account access are left out until a dashboard asks for them.
export const WORKSPACE_ACTIONS = ["cloudwatch:GetMetricData", "cloudwatch:ListMetrics"] as const;
// #endregion actions

export class GrafanaStack extends Stack {
  constructor(scope: Construct, id: string, props: GrafanaStackProps = {}) {
    super(scope, id, props);

    // #region role
    const role = new iam.Role(this, "WorkspaceRole", {
      description: "What the Grafana workspace may read in this account",
      // Only a workspace of this account and Region may take the role, not Grafana on behalf of anyone.
      assumedBy: new iam.ServicePrincipal("grafana.amazonaws.com", {
        conditions: {
          StringEquals: { "aws:SourceAccount": this.account },
          ArnLike: {
            "aws:SourceArn": `arn:${this.partition}:grafana:${this.region}:${this.account}:/workspaces/*`,
          },
        },
      }),
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [...WORKSPACE_ACTIONS],
        // Metric data has no ARN to name: both actions are granted on every metric of the account.
        resources: ["*"],
      }),
    );
    // #endregion role
    new CfnOutput(this, "WorkspaceRoleArn", { value: role.roleArn });

    if (props.authentication === undefined) {
      return;
    }

    // #region workspace
    const workspace = new grafana.CfnWorkspace(this, "Workspace", {
      name: "aih-notes",
      description: "AWS in Your Hands chapter 55: the notes API's dashboard",
      accountAccessType: "CURRENT_ACCOUNT",
      authenticationProviders: [props.authentication],
      // The role above, and nothing the service would add by itself.
      permissionType: "CUSTOMER_MANAGED",
      roleArn: role.roleArn,
      // Admins of the workspace cannot install plugins: every plugin is code run next to the data.
      pluginAdminEnabled: false,
      ...(props.grafanaVersion === undefined ? {} : { grafanaVersion: props.grafanaVersion }),
      ...(props.prefixListIds === undefined || props.prefixListIds.length === 0
        ? {}
        : {
            networkAccessControl: {
              prefixListIds: [...props.prefixListIds],
              // No VPC endpoint is allowed in. The property is required once the block exists.
              vpceIds: [],
            },
          }),
    });
    // #endregion workspace

    new CfnOutput(this, "WorkspaceId", { value: workspace.attrId });
    new CfnOutput(this, "WorkspaceEndpoint", { value: workspace.attrEndpoint });
  }
}
