import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { type EcrConfig, parseEcrConfig } from "../../src/config.ts";
import { lifecyclePolicySchema } from "../../src/lifecycle.ts";
import { POLICY } from "../../src/policy.ts";
import { EcrStack } from "../lib/ecr-stack.ts";

const synth = (context: Partial<Record<keyof EcrConfig, string>> = {}) =>
  Template.fromStack(
    new EcrStack(new App(), "AihEcr", {
      env: { region: "ap-northeast-1" },
      config: parseEcrConfig(context),
    }),
  );

const alone = synth();
const withRole = synth({ githubRepository: "example/notes" });
const withCache = synth({ githubRepository: "example/notes", pullThroughCache: "on" });

type Statement = { Sid: string; Effect: string; Action: string | string[]; Resource: unknown };
const statementsOf = (template: Template) =>
  Object.values(template.findResources("AWS::IAM::Role")).flatMap((role) =>
    (role["Properties"].Policies as { PolicyDocument: { Statement: Statement[] } }[]).flatMap(
      (policy) => policy.PolicyDocument.Statement,
    ),
  );
const actionsOf = (template: Template) =>
  statementsOf(template)
    .flatMap((statement) => statement.Action)
    .toSorted();
const REPOSITORY_ARN = { "Fn::GetAtt": ["Repository22E53BBD", "Arn"] };

describe("the repository", () => {
  it("lets no tag move and scans on push", () => {
    alone.hasResourceProperties("AWS::ECR::Repository", {
      ImageTagMutability: "IMMUTABLE",
      ImageScanningConfiguration: { ScanOnPush: true },
    });
    // No exceptions to immutability, and no policy that opens it to another account.
    const [repository] = Object.values(alone.findResources("AWS::ECR::Repository"));
    // Nothing set: ECR's default encryption, which has no KMS key to pay for or lose.
    expect(repository?.["Properties"]).not.toHaveProperty("EncryptionConfiguration");
    expect(repository?.["Properties"]).not.toHaveProperty("ImageTagMutabilityExclusionFilters");
    expect(repository?.["Properties"]).not.toHaveProperty("RepositoryPolicyText");
  });

  it("deploys exactly the lifecycle policy the tests evaluate", () => {
    const [repository] = Object.values(alone.findResources("AWS::ECR::Repository"));
    const text = repository?.["Properties"].LifecyclePolicy.LifecyclePolicyText as string;
    expect(v.parse(lifecyclePolicySchema, JSON.parse(text))).toEqual(POLICY);
  });

  it("goes away with the stack, images included: a practice setting", () => {
    alone.hasResource("AWS::ECR::Repository", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
      Properties: { EmptyOnDelete: true },
    });
  });

  it("is the only resource until a GitHub repository is named", () => {
    expect(Object.keys(alone.toJSON().Resources)).toHaveLength(1);
  });
});

describe("the push role", () => {
  it("can be assumed only by one branch of one GitHub repository, through the account's provider", () => {
    withRole.hasResourceProperties("AWS::IAM::Role", {
      MaxSessionDuration: 3600,
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Effect: "Allow",
            Action: "sts:AssumeRoleWithWebIdentity",
            Principal: {
              Federated: {
                "Fn::Join": [
                  "",
                  [
                    "arn:",
                    { Ref: "AWS::Partition" },
                    ":iam::",
                    { Ref: "AWS::AccountId" },
                    ":oidc-provider/token.actions.githubusercontent.com",
                  ],
                ],
              },
            },
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub": "repo:example/notes:ref:refs/heads/main",
              },
            },
          },
        ],
      },
    });
  });

  it("refuses a repository or branch name that would put a wildcard in the trust policy", () => {
    expect(() => parseEcrConfig({ githubRepository: "example/*" })).toThrow(/githubRepository/);
    expect(() => parseEcrConfig({ githubRepository: "example/notes", pushBranch: "*" })).toThrow(
      /pushBranch/,
    );
  });

  it("may push to this repository and read its scan results, and nothing else", () => {
    expect(actionsOf(withRole)).toEqual([
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImageScanFindings",
      "ecr:DescribeImages",
      "ecr:GetAuthorizationToken",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]);
  });

  it("cannot delete an image or change the repository's settings", () => {
    const actions = actionsOf(withCache);
    for (const forbidden of [
      "ecr:BatchDeleteImage",
      "ecr:PutImageTagMutability",
      "ecr:PutLifecyclePolicy",
      "ecr:SetRepositoryPolicy",
      "ecr:DeleteRepository",
      "ecr:*",
      "*",
    ]) {
      expect(actions).not.toContain(forbidden);
    }
  });

  it("names the repository in every statement but the registry login", () => {
    for (const statement of statementsOf(withRole)) {
      expect(statement.Effect).toBe("Allow");
      expect(statement.Resource).toEqual(statement.Sid === "LogIn" ? "*" : REPOSITORY_ARN);
    }
    expect(JSON.stringify(withRole.toJSON()).match(/"\*"/g)).toHaveLength(1);
  });
});

describe("the pull-through cache", () => {
  it("is absent by default", () => {
    withRole.resourceCountIs("AWS::ECR::PullThroughCacheRule", 0);
  });

  it("caches Amazon ECR Public, which needs no stored credential", () => {
    withCache.hasResourceProperties("AWS::ECR::PullThroughCacheRule", {
      EcrRepositoryPrefix: "ecr-public",
      UpstreamRegistryUrl: "public.ecr.aws",
    });
    const [rule] = Object.values(withCache.findResources("AWS::ECR::PullThroughCacheRule"));
    expect(rule?.["Properties"]).not.toHaveProperty("CredentialArn");
    withCache.resourceCountIs("AWS::SecretsManager::Secret", 0);
  });

  it("lets the push role pull and import only under the cache's prefix", () => {
    const cache = statementsOf(withCache).find(
      (statement) => statement.Sid === "PullBaseImagesThroughTheCache",
    );
    expect(cache?.Action).toEqual([
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchImportUpstreamImage",
      "ecr:CreateRepository",
    ]);
    expect(JSON.stringify(cache?.Resource)).toContain(":repository/ecr-public/*");
  });
});

describe("resource types", () => {
  // cdkd 0.296.28 has its own provider for the first two; the cache rule goes through Cloud Control.
  it("uses only the types the chapter checked against cdkd", () => {
    const types = (template: Template) =>
      [
        ...new Set(
          Object.values(template.toJSON().Resources).map((r) => (r as { Type: string }).Type),
        ),
      ].toSorted();
    expect(types(alone)).toEqual(["AWS::ECR::Repository"]);
    expect(types(withRole)).toEqual(["AWS::ECR::Repository", "AWS::IAM::Role"]);
    expect(types(withCache)).toEqual([
      "AWS::ECR::PullThroughCacheRule",
      "AWS::ECR::Repository",
      "AWS::IAM::Role",
    ]);
  });
});
