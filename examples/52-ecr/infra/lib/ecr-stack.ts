import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

import { CACHE_PREFIX, CACHE_UPSTREAM, type EcrConfig } from "../../src/config.ts";
import type { LifecyclePolicy } from "../../src/lifecycle.ts";
import { POLICY } from "../../src/policy.ts";

export const GITHUB_ISSUER = "token.actions.githubusercontent.com";

// #region rules
const TAG_STATUS = {
  tagged: ecr.TagStatus.TAGGED,
  untagged: ecr.TagStatus.UNTAGGED,
  any: ecr.TagStatus.ANY,
} as const;

/** The policy the tests evaluate, handed to CDK rule by rule. A test compares the template with it. */
export function lifecycleRules(policy: LifecyclePolicy): ecr.LifecycleRule[] {
  return policy.rules.map(({ rulePriority, description, selection }) => ({
    rulePriority,
    description,
    tagStatus: TAG_STATUS[selection.tagStatus],
    tagPatternList: selection.tagPatternList,
    ...(selection.countType === "imageCountMoreThan"
      ? { maxImageCount: selection.countNumber }
      : { maxImageAge: Duration.days(selection.countNumber) }),
  }));
}
// #endregion rules

export type EcrStackProps = StackProps & { config: EcrConfig };

export class EcrStack extends Stack {
  constructor(scope: Construct, id: string, props: EcrStackProps) {
    super(scope, id, props);
    const { config } = props;

    // #region repository
    const repository = new ecr.Repository(this, "Repository", {
      // No tag may ever be pointed at another image. No exceptions, `latest` included.
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      imageScanOnPush: true,
      lifecycleRules: lifecycleRules(POLICY),
      // For practice: destroy takes the images with it.
      emptyOnDelete: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // #endregion repository

    new CfnOutput(this, "RepositoryUri", { value: repository.repositoryUri });
    new CfnOutput(this, "RepositoryName", { value: repository.repositoryName });

    const inRegistry = (path: string) =>
      `arn:${this.partition}:ecr:${this.region}:${this.account}:repository/${path}`;

    // #region cache
    if (config.pullThroughCache === "on") {
      // Pulling <registry>/ecr-public/<name> fetches public.ecr.aws/<name> once and keeps a copy here.
      new ecr.CfnPullThroughCacheRule(this, "PublicCache", {
        ecrRepositoryPrefix: CACHE_PREFIX,
        upstreamRegistryUrl: CACHE_UPSTREAM,
      });
    }
    // #endregion cache

    if (config.githubRepository === undefined) {
      return;
    }

    // #region trust
    // Chapter 20 created the provider. An account holds one per issuer, so this stack only names it.
    const providerArn = `arn:${this.partition}:iam::${this.account}:oidc-provider/${GITHUB_ISSUER}`;
    const builds = new iam.WebIdentityPrincipal(providerArn, {
      StringEquals: {
        [`${GITHUB_ISSUER}:aud`]: "sts.amazonaws.com",
        // One branch of one repository. A pull request from a fork gets another subject.
        [`${GITHUB_ISSUER}:sub`]: `repo:${config.githubRepository}:ref:refs/heads/${config.pushBranch}`,
      },
    });
    // #endregion trust

    // #region push
    const statements = [
      new iam.PolicyStatement({
        sid: "LogIn",
        actions: ["ecr:GetAuthorizationToken"],
        // The token is for the registry, so this action takes no repository.
        resources: ["*"],
      }),
      new iam.PolicyStatement({
        sid: "PushToOneRepository",
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          "ecr:BatchGetImage",
        ],
        resources: [repository.repositoryArn],
      }),
      new iam.PolicyStatement({
        sid: "ReadScanResults",
        actions: ["ecr:DescribeImages", "ecr:DescribeImageScanFindings"],
        resources: [repository.repositoryArn],
      }),
    ];
    if (config.pullThroughCache === "on") {
      statements.push(
        new iam.PolicyStatement({
          sid: "PullBaseImagesThroughTheCache",
          actions: [
            "ecr:BatchGetImage",
            "ecr:GetDownloadUrlForLayer",
            // The first pull of an image imports it, and creates its repository.
            "ecr:BatchImportUpstreamImage",
            "ecr:CreateRepository",
          ],
          resources: [inRegistry(`${CACHE_PREFIX}/*`)],
        }),
      );
    }
    const pushRole = new iam.Role(this, "PushRole", {
      assumedBy: builds,
      description: "CI: push images to one repository and read their scan results",
      maxSessionDuration: Duration.hours(1),
      // Inline, so the role and its permissions are one resource that drift detection compares.
      inlinePolicies: { Push: new iam.PolicyDocument({ statements }) },
    });
    // #endregion push

    new CfnOutput(this, "PushRoleArn", { value: pushRole.roleArn });
  }
}
