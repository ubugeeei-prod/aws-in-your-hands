import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { OidcProviderNative, PolicyDocument, PolicyStatement, Role, WebIdentityPrincipal } from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import { API_STACK_PREFIX, type CiConfig } from "./config.ts";

export const GITHUB_ISSUER = "token.actions.githubusercontent.com";
export const PREVIEW_ENVIRONMENT = "preview";

// #region subjects
/** The `sub` claim GitHub puts in the token for each kind of job. One exact string per role. */
export function githubSubjects(ci: CiConfig) {
  const repo = `repo:${ci.githubRepository}`;
  return {
    // A job triggered by pull_request that names no environment.
    plan: `${repo}:pull_request`,
    // A job that names an environment gets this instead of its branch.
    deploy: `${repo}:environment:${ci.productionEnvironment}`,
    preview: `${repo}:environment:${PREVIEW_ENVIRONMENT}`,
    // Scheduled and manually dispatched runs on the deploy branch.
    drift: `${repo}:ref:refs/heads/${ci.deployBranch}`,
  };
}
// #endregion subjects

export type CiStackProps = StackProps & { ci: CiConfig };

/** GitHub's OIDC provider and the roles its workflows may assume. Deployed once, by a person. */
export class CiStack extends Stack {
  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);
    const { ci } = props;

    // #region provider
    const providerArn =
      ci.existingOidcProviderArn ??
      new OidcProviderNative(this, "GitHub", {
        url: `https://${GITHUB_ISSUER}`,
        clientIds: ["sts.amazonaws.com"],
        removalPolicy: RemovalPolicy.DESTROY,
      }).oidcProviderArn;
    // #endregion provider

    // #region trust
    // StringEquals on both claims: the token must be for STS, and from exactly this job kind.
    const github = (subject: string) =>
      new WebIdentityPrincipal(providerArn, {
        StringEquals: { [`${GITHUB_ISSUER}:aud`]: "sts.amazonaws.com", [`${GITHUB_ISSUER}:sub`]: subject },
      });
    const subjects = githubSubjects(ci);
    // #endregion trust

    const inAccount = (service: string, resource: string) =>
      `arn:${this.partition}:${service}:${this.region}:${this.account}:${resource}`;
    const shipStacks = inAccount("cloudformation", `stack/${API_STACK_PREFIX}*/*`);

    // #region bootstrap-roles
    // The roles `cdk bootstrap` created. They trust this account, so allowing sts:AssumeRole here is enough.
    const bootstrapRole = (kind: "deploy" | "file-publishing" | "lookup") =>
      `arn:${this.partition}:iam::${this.account}:role/cdk-${ci.bootstrapQualifier}-${kind}-role-${this.account}-${this.region}`;
    const assume = (...kinds: Parameters<typeof bootstrapRole>[0][]) =>
      new PolicyStatement({
        sid: "AssumeBootstrapRoles",
        actions: ["sts:AssumeRole"],
        resources: kinds.map(bootstrapRole),
      });
    // For the status and smoke tasks, which ask CloudFormation directly instead of going through the CDK CLI.
    const readStatus = new PolicyStatement({
      sid: "ReadShipStackStatus",
      actions: ["cloudformation:DescribeStacks"],
      resources: [shipStacks],
    });

    const role = (id: string, subject: string, description: string, statements: PolicyStatement[]) =>
      new Role(this, id, {
        assumedBy: github(subject),
        description,
        maxSessionDuration: Duration.hours(1),
        // Inline, so the role and its permissions are one resource that drift detection compares.
        inlinePolicies: { [id]: new PolicyDocument({ statements }) },
      });

    // `cdk diff --method template` reads through the lookup role, which cannot change anything.
    const plan = role("PlanRole", subjects.plan, "Pull requests: cdk diff", [assume("lookup")]);
    // `cdk deploy` uploads assets, then hands the template to CloudFormation.
    const deploying = [assume("deploy", "file-publishing"), readStatus];
    const deploy = role("DeployRole", subjects.deploy, "Production deploys", deploying);
    const preview = role("PreviewRole", subjects.preview, "Preview stacks", deploying);
    // #endregion bootstrap-roles

    // #region drift-role
    const functions = inAccount("lambda", `function:${API_STACK_PREFIX}*`);
    const drift = role("DriftRole", subjects.drift, "Scheduled drift detection: reads only", [
      new PolicyStatement({
        sid: "DetectOnShipStacks",
        actions: [
          "cloudformation:DetectStackDrift",
          "cloudformation:DetectStackResourceDrift",
          "cloudformation:DescribeStackResourceDrifts",
          "cloudformation:ListStackResources",
          "cloudformation:DescribeStacks",
        ],
        resources: [shipStacks],
      }),
      // Detection reads each resource with the caller's permissions. These are the read
      // handler permissions each resource type publishes in its CloudFormation schema.
      new PolicyStatement({
        sid: "ReadFunctions",
        actions: [
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration",
          "lambda:GetFunctionCodeSigningConfig",
          "lambda:GetFunctionRecursionConfig",
          "lambda:GetFunctionScalingConfig",
          "lambda:GetRuntimeManagementConfig",
          "lambda:GetProvisionedConcurrencyConfig",
          "lambda:GetAlias",
          "lambda:GetPolicy",
        ],
        resources: [functions, `${functions}:*`],
      }),
      new PolicyStatement({
        sid: "ReadRoles",
        actions: ["iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies"],
        resources: [`arn:${this.partition}:iam::${this.account}:role/${API_STACK_PREFIX}*`],
      }),
      new PolicyStatement({
        sid: "ReadHttpApis",
        actions: ["apigateway:GET"],
        // API IDs are random, so this cannot be narrowed to the stacks' own APIs.
        resources: [`arn:${this.partition}:apigateway:${this.region}::/apis/*`],
      }),
      new PolicyStatement({
        sid: "ReadLogGroups",
        actions: ["logs:ListTagsForResource", "logs:GetDataProtectionPolicy"],
        resources: [inAccount("logs", `log-group:${API_STACK_PREFIX}*`)],
      }),
      new PolicyStatement({
        sid: "ActionsWithoutResourceLevelPermissions",
        actions: [
          "cloudformation:DescribeStackDriftDetectionStatus",
          "cloudformation:BatchDescribeTypeConfigurations",
          "logs:DescribeLogGroups",
          "logs:DescribeIndexPolicies",
          "logs:DescribeResourcePolicies",
        ],
        resources: ["*"],
      }),
    ]);
    // #endregion drift-role

    new CfnOutput(this, "PlanRoleArn", { value: plan.roleArn });
    new CfnOutput(this, "DeployRoleArn", { value: deploy.roleArn });
    new CfnOutput(this, "PreviewRoleArn", { value: preview.roleArn });
    new CfnOutput(this, "DriftRoleArn", { value: drift.roleArn });
  }
}
