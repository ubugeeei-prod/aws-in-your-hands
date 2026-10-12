---
title: "20 CI/CD: Costs, Pitfalls, and Cleanup"
---

# 20 CI/CD: Costs, Pitfalls, and Cleanup

This is the last page of the chapter. It covers how this differs from Cloudflare Workers, what it costs, where you are likely to get stuck, what to add for production, and how to clean up, and it ends with what was and was not verified.

## If you come from Workers

<!-- section: 20.workers -->

Compared with deploying Cloudflare Workers, these are the differences.

| | Cloudflare Workers | This chapter |
| --- | --- | --- |
| Deploy | `wrangler deploy` creates a version and switches to 100% at once | Synth, then CloudFormation applies the template's differences one by one |
| Versions and switching | Versions and deployments. Traffic can be split between two versions by percentage | Lambda versions and an alias. Weights are possible but not implemented here |
| Going back | `wrangler rollback`, to one of the 100 most recent versions | CloudFormation puts things back on failure. Later, revert the code and deploy |
| CI authentication | The documented setup stores an API token as a CI secret | OIDC, receiving credentials valid for one hour. No secret is stored |
| What does not come back | The contents of KV, R2, D1, and so on are not part of a version | Data, schema, and whatever left the system |

Workers takes far fewer steps. A Worker is one unit, so switching versions is instant. This chapter is long because it updates separate resources in sequence, API Gateway, Lambda, a role, and a log group, and the problem of a deploy stopping half-way comes from the same place.

Both have things that do not come back.

## Money

Amounts are in USD, for the Tokyo Region, on demand, before tax. The calculations are in [Pricing calculations](/en/reference/pricing.md).

What this chapter adds costs almost nothing in itself. CloudFormation makes no additional charge for resource types beginning with `AWS::`. IAM roles and the OIDC provider are part of IAM, also at no additional charge. The contents of the stack, an HTTP API and Lambda, are as in chapter 04 and cost 0 when nobody calls them. Drift detection incurs no CloudFormation charge either.

What grows is the CDK asset bucket. Each deploy adds one zip of the function's code. For one deploy a day over a year with no cleanup, the storage charge works out to less than one cent a month (USD 0.001192, assuming 137 KB per zip and S3 Standard at USD 0.025 per GB-month). The 137 KB is this chapter's bundle compressed locally, not a measurement of the zip the CLI actually makes. For a stack that uses container images, the order of magnitude changes.

GitHub Actions charges are not part of the AWS bill. According to GitHub's documentation, standard runners are free in public repositories, and private repositories get free minutes each month by plan (2,000 on GitHub Free). How many minutes one run of this chapter's workflows takes is unknown, since they have not been run.

What a preview stack costs depends on what is in it, as the [preview section](/en/chapters/20-shipping/build.md) said.

Consider also what it costs when the API gets hammered. This chapter's API, in dev, prod, and every preview, has no authentication and can be called by anyone. What holds it back is the stage throttle, which lets through 10 requests a second (burst 20) per stack and answers the rest with a 429. Requests at that limit for 30 days come to at most 25.92 million, which by chapter 04's arithmetic is **52.43 a month per stack** (API Gateway 33.44, Lambda 9.50, logs 9.49). With dev, prod, and three open previews, that is five times as much, about 262. It is one more reason to delete stacks you are not using.

Notes are stored in chapter 04's in-memory repository, so they stop at 100 per execution environment. Response sizes are chapter 04's too: a list is 20 summaries and at most 20 KiB, and one note is at most 64 KiB. For how far data transfer can go, the calculation on [chapter 04's costs page](/en/chapters/04-http-api/wrap.md) applies unchanged (up to about USD 180 a month). What to add before real users arrive is also the same as in chapter 04: authentication (chapter 06), and AWS WAF with CloudFront in front (chapter 21; the web ACL is 8.00 a month).

## Where you get stuck

The table below does not list problems met by running anything. It lists the places where the documentation and the code show you are likely to get stuck.

| If this happens | Look here |
| --- | --- |
| `cdk deploy` says the environment is not bootstrapped, or it cannot assume a role | Check that `vp run ship:cfn:bootstrap` has been run for this account and Region. cdkd's bootstrap is no substitute |
| `AssumeRoleWithWebIdentity` is refused in GitHub Actions | The token's `sub` and the string in the trust policy must match to the character. Check whether the job has an `environment`, and whether the repository uses the form with IDs (`owner@123/repo@456`) |
| Deploying `AihShipCi` fails because the OIDC provider already exists | The account already has one. Add `-c existingOidcProviderArn=...` |
| The first deploy failed and the stack remains in `ROLLBACK_COMPLETE` | CloudFormation cannot update this stack. On the next `ship:cfn:deploy` the CLI deletes it and creates it again. Find the cause of the failure in the events first |
| `ship:cfn:drift` is `failed` and the reason says `not authorized` | The DriftRole lacks permission to read that resource type. Add it in `ci-stack.ts` |
| `ship:cfn:drift` ends with 11 every time | An unchecked type is not on the list in `drift-coverage.ts`. Check the support table to see whether it really cannot be checked, then add it |
| `ship:cfn:diff` is empty but the behavior differs | The diff compares templates. Run `vp run ship:cfn:drift` |
| The prod stack cannot be deleted | Termination protection is on. If you really mean to delete the stack, turn it off in the console first |

## Taking it to production

- Narrow the cfn-exec role. The default is `AdministratorAccess`. Pass only the policies you need when bootstrapping, and add a permissions boundary. Every job that can use the deploy role reaches as far as the cfn-exec role's permissions
- Separate the accounts. As long as dev, previews, and prod share an account, only names keep them apart
- Limit previews to branches you trust. If you enable previews with neither of the two items above, **everyone who can push a branch can become an administrator of the account**
- Protect the `production` environment. Limit the branches that may deploy to main, and require approval. What the trust policy trusts is this environment's name
- Add something that stops on error rate, then shift gradually. Alias weights and CodeDeploy go together with alarms ([chapter 19](/en/chapters/19-observability.md))
- Send the drift report somewhere people look. Do not rely only on the notification of a failed job, because schedules can stop
- Clean up assets. The pinned CLI has `cdk gc`. This chapter has not tried it
- Watch the OIDC provider and the CI roles for drift too. This chapter's DriftRole can read only stacks whose names begin with `AihShipApi`. If someone rewrites `AihShipCi`, nobody will notice

## Cleaning up

<!-- section: 20.cleanup -->

```bash
vp run ship:preview:list
vp run ship:cfn:destroy
vp run ship:ci:destroy
```

If preview stacks remain, delete them one at a time with `vp run ship:cfn:destroy -c stage=pr-<number>`. If you created prod, turn off termination protection and then delete it with `-c stage=prod`. The prod log group remains after the stack is deleted.

`ship:ci:destroy` removes the OIDC provider and the four roles. Delete the variables in the GitHub repository and the workflows you copied to `.github/workflows/` yourself. Workflows left in place will try to assume roles that no longer exist and fail every day.

The last thing left is the CDK bootstrap. You can delete the `CDKToolkit` stack from the CloudFormation console, but the asset bucket is configured to remain, so empty it and delete it separately. If other CDK apps use `cdk deploy` in the same account, do not delete the bootstrap. There is no task for cleaning it up.

This chapter changed nothing in cdkd's bootstrap (chapter 02) or in chapter 04's `AihHttpApi`.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (drift polling, classification, and gate; the call order through a substituted SDK client; trust policies and role permissions; a stack per stage; CDK CLI arguments; the next step for each stack status; preview listing; the workflow YAML). The type check. Synthesis with the pinned CDK CLI (`ship:cfn:synth`, also with other stages). That passing an unknown stage, and trying to deploy the CI roles without naming a repository, both stop before any AWS call. All of this was checked on macOS (Apple silicon).

**Not checked yet.** Nothing that touches AWS or GitHub has been run: `ship:cfn:bootstrap`, `ship:cfn:diff`, `ship:cfn:deploy`, `ship:smoke`, `ship:cfn:status`, `ship:cfn:drift`, `ship:preview:list`, `ship:cfn:destroy`, `ship:ci:diff`, `ship:ci:deploy`, `ship:ci:destroy`, the four workflows, the "Break it on purpose" procedure, and `cdkd export` and `cdkd import --migrate-from-cloudformation`. In particular, the following points wait for a real environment.

- That IAM accepts the trust policies and only the intended jobs can assume the roles. Whether a token is issued for a pull request from a fork
- That `cdk diff` and `cdk deploy` work by assuming the bootstrap roles from the GitHub roles
- That the DriftRole's read permissions are enough for a real detection
- The actual shape of CloudFormation's drift responses. The fixtures were written from the API reference and the SDK's types. The name and message of the error for a missing stack are also an expectation
- That the integration goes unchecked, that a change to the inline policy shows as drift on the role, and that result times are at or after the detection's start time
- What the rollback of a failed deploy looks like, and that old versions remain
- That the Nix devShell works on an x86_64-linux runner
- That the stage throttle (`DefaultRouteSettings`: 10 a second, burst 20) is applied through CloudFormation and that requests beyond it get a 429. A test sees it in the template. Whether drift detection compares this property is also unchecked
- The path described in the preview section (that the pull request's own workflow file is the one that runs, and that the PreviewRole reaches as far as the cfn-exec role's permissions). It was read from GitHub's and the CDK's documentation and from this chapter's role definitions, and has not been tried. For `--custom-permissions-boundary`, only its presence in the pinned CLI was confirmed

**Relation to cdkd.** This chapter's two stacks are not deployed with cdkd, but this book's rule is to check anyway. The pinned cdkd (0.296.28) registers no dedicated implementation for `AWS::Lambda::Alias`, `AWS::Lambda::Version`, or `AWS::IAM::OIDCProvider`. The other types (`AWS::ApiGatewayV2::*`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::Logs::LogGroup`) have one.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The two paths, once more | `examples/20-shipping/src/cdk-args.ts`, `scripts/cdk.ts`, `cdk.json` | `ship:cfn:bootstrap`, `ship:cfn:synth` |
| A separate stack for each environment | `examples/20-shipping/infra/lib/config.ts`, `infra/lib/ship-api-stack.ts`, `infra/bin/app.ts`, `infra/test/ship-api-stack.test.ts` | `ship:cfn:synth`, `test:unit` |
| Handing it to CloudFormation | `examples/20-shipping/src/cdk-args.ts`, `test/cdk-args.test.ts`, `scripts/smoke.ts`, `src/stack-info.ts` | `ship:cfn:diff`, `ship:cfn:deploy`, `ship:smoke` |
| Getting into AWS without a stored key | `examples/20-shipping/infra/lib/ci-stack.ts`, `infra/lib/config.ts`, `infra/test/ci-stack.test.ts` | `ship:ci:diff`, `ship:ci:deploy`, `test:unit` |
| What each role may do | `examples/20-shipping/infra/lib/ci-stack.ts`, `infra/test/ci-stack.test.ts` | `test:unit` |
| The workflows | `examples/20-shipping/workflows/`, `test/workflows.test.ts` | `test:unit` |
| A preview per pull request | `examples/20-shipping/workflows/preview.yml`, `src/previews.ts`, `scripts/previews.ts`, `test/previews.test.ts` | `ship:preview:list` |
| What comes back, and what does not | `examples/20-shipping/infra/lib/ship-api-stack.ts` | `test:unit` |
| A deploy stops half-way | `examples/20-shipping/src/stack-status.ts`, `test/stack-status.test.ts`, `scripts/status.ts` | `ship:cfn:status` |
| CloudFormation drift through the same gate | `tools/src/drift/cloudformation.ts`, `cloudformation-schema.ts`, `cloudformation.test.ts`, `fixtures/cloudformation/`, `examples/20-shipping/src/drift-client.ts`, `test/drift-client.test.ts`, `scripts/drift.ts` | `ship:cfn:drift`, `test:unit` |
| `IN_SYNC` is not "everything matches" | `examples/20-shipping/src/drift-coverage.ts`, `infra/test/ship-api-stack.test.ts` | `ship:cfn:drift`, `test:unit` |
| Cleaning up | `examples/20-shipping/scripts/cdk.ts` | `ship:cfn:destroy`, `ship:ci:destroy` |
| Money | `data/pricing/`, `tools/src/pricing/calc.test.ts` | `test:unit` |

**Primary sources** (all checked 2026-10-12)

- CloudFormation: [drift detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html), [detecting drift on a whole stack](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/detect-drift-stack.html), [resource type support](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/resource-import-supported-resources.html), [failure options](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-failure-options.html), [stack statuses](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/view-stack-events.html), [continuing a rollback](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-continueupdaterollback.html), [change sets](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets.html), [stack policies](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/protect-stack-resources.html), [termination protection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-protect-stacks.html), [pricing](https://aws.amazon.com/cloudformation/pricing/)
- CloudFormation API reference: [DetectStackDrift](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DetectStackDrift.html), [DescribeStackDriftDetectionStatus](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeStackDriftDetectionStatus.html), [DescribeStackResourceDrifts](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeStackResourceDrifts.html), [StackResourceDrift](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_StackResourceDrift.html), [ListStackResources](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ListStackResources.html), [CreateStack](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateStack.html)
- AWS CDK: [bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html), [bootstrapping an environment](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping-env.html), [cdk diff](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-diff.html), [cdk drift](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-drift.html), [aws-cdk 2.1145.0](https://www.npmjs.com/package/aws-cdk/v/2.1145.0) (help output, README, `cdk bootstrap --show-template`)
- IAM: [roles for OIDC](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html), [creating an OIDC provider](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html), [IAM FAQs](https://aws.amazon.com/iam/faqs/)
- Sources for permissions: [CloudFormation resource type schemas](https://schema.cloudformation.ap-northeast-1.amazonaws.com/CloudformationSchema.zip), AWS service reference ([CloudFormation](https://servicereference.us-east-1.amazonaws.com/v1/cloudformation/cloudformation.json), [CloudWatch Logs](https://servicereference.us-east-1.amazonaws.com/v1/logs/logs.json))
- GitHub: [OpenID Connect reference](https://docs.github.com/en/actions/reference/security/oidc), [configuring OIDC in AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws), [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use), [events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- Actions: [aws-actions/configure-aws-credentials v6.3.0](https://github.com/aws-actions/configure-aws-credentials/tree/e1253824e5c10ff9df46874f81ed3ec929e19cfd). For `actions/checkout` v7.0.1, `cachix/install-nix-action` v31.11.1, and `actions/upload-artifact` v7.0.2, the latest release and its commit were read from GitHub's API
- Lambda: [versions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html), [weighted aliases](https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html), [CodeDeploy deployment configurations](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployment-configurations.html)
- cdkd: [Introduction](https://cdkd.dev/introduction/), [Drift](https://cdkd.dev/drift/index.html), [drift CLI reference](https://cdkd.dev/cli-drift/index.html), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (help for `export` and `import`, provider registration)
- Cloudflare Workers: [Versions & deployments](https://developers.cloudflare.com/workers/versions-and-deployments/), [Gradual deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/), [Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/), [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [@aws-sdk/client-cloudformation 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-cloudformation/v/3.1149.0), [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) (type definitions)

:::
