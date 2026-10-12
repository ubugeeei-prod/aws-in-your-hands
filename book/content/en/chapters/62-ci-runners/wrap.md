---
title: "62 CI Runners: Costs, Pitfalls, and Cleanup"
---

# 62 CI Runners: Costs, Pitfalls, and Cleanup

## Cost

<!-- section: 62.cost -->

AWS amounts are in USD for the Tokyo Region, on demand, before tax, with a month of 730 hours. The arithmetic is in [Pricing](/en/reference/pricing.md). GitHub's rates are the values in GitHub's documentation on 2026-10-13.

A month without a single job costs this.

| Item | Quantity | Unit price | Per month |
| --- | --- | --- | --- |
| Secrets Manager secrets | 2 | 0.40 a month | 0.80 |
| Sweeper Lambda | 2,920 runs × 1 s (assumed) × 256 MB | Within the free allowance | 0.01 |
| EventBridge Scheduler | 2,920 invocations | Within the free allowance | 0.00 |
| Subtotal | | | **0.81** |

After Lambda's monthly free allowance it is USD 0.80. The cluster, the task definition, the function URL, the security group, and an empty DynamoDB table cost nothing for existing. Nothing in the stack is billed by the hour.

When jobs run, the task's time is billed.

<<< @/examples/62-ci-runners/src/cost.ts{job}

One 2 vCPU, 8 GB, arm64 task is about USD 0.0020 a minute: 2 × 0.04045 for vCPU, 8 × 0.00442 for memory, and 0.005 for the public IPv4 address, USD 0.12126 an hour together. Fargate bills by the second, with a one-minute minimum, from the start of the image pull until the task stops. The start-up time before a job is taken is billed too.

The comparison is with the list price of GitHub's runners.

<<< @/examples/62-ci-runners/src/cost.ts{hosted}

Take 1,000 five-minute jobs a month and compare three ways. For your own runners the arithmetic uses six minutes: five for the job and one for the image pull and registration. That one minute is an assumption, not a measurement.

| Way | Arithmetic | Per month |
| --- | --- | --- |
| GitHub's runner (Linux 2-core, arm64) | 5,000 minutes × 0.005 | 25.00 |
| GitHub's runner (Linux 2-core, x64) | 5,000 minutes × 0.006 | 30.00 |
| This chapter's design (Fargate) | 6,000 task-minutes | 12.13 |
| CodeBuild-hosted runner (arm1.small) | 6,000 minutes × 0.00425 | 25.50 |

Fargate's 12.13 is 8.09 for vCPU, 3.54 for memory, and 0.50 for public IPv4 addresses. Adding the receiving Lambda, the DynamoDB writes, and the Secrets Manager calls makes it 12.16, or 12.15 after Lambda's free allowance. CodeBuild is 25.08 after its 100 free minutes a month. arm1.small is not the same size as this chapter's task, and CodeBuild's start-up time was not measured either.

The table compares list prices, which is not what you are billed. GitHub's plans include minutes each month (2,000 on Free, 3,000 on Team). On the Team plan, 5,000 minutes are billed as 2,000, USD 10.00, which is less than this chapter's design. How included minutes are counted for each kind of runner was not checked.

The point where the included minutes stop mattering can be computed.

<<< @/examples/62-ci-runners/src/cost.ts{break-even}

On a plan that includes 3,000 minutes, against the arm64 Linux runner, the point is 5,826 minutes a month, about 1,165 five-minute jobs. Below that, price gives no reason to run your own. Above it the gap widens: 20,000 jobs a month (100,000 minutes) are USD 500.00 at GitHub's list price and USD 242.52 on this chapter's design.

Two more things about cost are worth knowing.

One is that GitHub's side of the price may change. In December 2025 GitHub announced a charge of USD 0.002 a minute for self-hosted runner usage as well, to begin on 2026-03-01. The change was then postponed. GitHub's announcement says it is postponed to take time to re-evaluate the approach, and gives no new date. The billing documentation on 2026-10-13 says usage on self-hosted runners is free. Were that charge added, a minute on this chapter's design would cost about 0.0044, leaving a little under USD 0.0006 a minute of difference from the arm64 runner's list price.

The other is what the comparison leaves out: logs, data transfer, the job time added by caches that no longer help, and the time of whoever maintains this. Updating the runner image, managing the GitHub App's key, and redelivering failed deliveries are yours to do.

A ceiling for a runaway can be computed as well. The sweeper stops a task after 6 hours, so a task waiting for a job that never comes costs at most USD 0.73 (6 hours × 0.12126). This chapter's code puts no limit on how many tasks run at once. What limits it is the account's Fargate vCPU quota ([chapter 32](/en/chapters/32-limits.md)).

## For readers coming from Cloudflare or Vercel

<!-- section: 62.platforms -->

Cloudflare and Vercel have almost nothing that corresponds to this chapter. With both, you connect a repository and the platform builds and deploys on machines it provides. A way to bring a build machine of your own was not found on the pages read on 2026-10-13 (for Cloudflare only the Workers Builds limits and pricing page, for Vercel only the page on managing builds).

| | Cloudflare Workers Builds | Vercel |
| --- | --- | --- |
| Build machine | 2 vCPU on Free, 4 vCPU on Paid; 8 GB on both | From Basic (2 vCPU, 8 GB) to Turbo (30 vCPU, 60 GB) |
| Included and price | 3,000 minutes a month on Free; 6,000 on Paid, then USD 0.005 a minute | Paid teams pay USD 0.007 a minute on Basic |
| Build time limit | 20 minutes | Not checked |

On neither platform is how a build's environment is separated from other builds, or how its image is updated, something the user thinks about. If building and deploying the app is all your CI does, staying there is simpler.

The same goes when you deploy from GitHub Actions. What makes a reason to run your own runner is not where you deploy to, but whether jobs have to reach things inside your own network, or whether the volume is large.

## As a distributed system

Four things hold state in this chapter. Whether a job is queued, and the runner registrations, are GitHub's. Which jobs a task was started for is in the DynamoDB table. Whether a task is running is ECS's. None of the four knows the others' state. The receiving Lambda connects them with calls that can fail.

The invariants are these.

- Nothing a job wrote is visible to the next job. What keeps it is that a task ends after one job, and the boundary between Fargate tasks. The first is a property of JIT runners and the second a statement in AWS's documentation; this chapter's tests can check neither
- At most one task is started for one job. `test/receive.test.ts` checks it under redelivery, simultaneous deliveries, a failed launch, and a receiver that stopped midway
- A job has no permission beyond the empty task role and a role it assumed by OIDC. The stack's assertions check that the task role has none

What is not kept is plain too. A delivery from GitHub may not arrive, and is not redelivered automatically. The job whose delivery was lost waits in the queue until someone redelivers it, and is cancelled after 24 hours. This chapter's design has nothing that finds a missed delivery. GitHub's documentation describes running, on a schedule, a script that looks up failed deliveries through the API and redelivers them. With a design in which your side holds the connection and asks GitHub, as runner scale sets do, the problem does not arise.

That jobs and runners are not paired one to one also remains. The number of runners started and the number of jobs queued should agree in the end, but while they differ, either a spare runner waits or a job does. The sweeper stops the first after 6 hours, and GitHub cancels the second after 24.

## Pitfalls

| When this happens | Look here |
| --- | --- |
| Every delivery in the history is 401 | The webhook secret differs from the value in Secrets Manager. Enter it in the app's settings again |
| 200 with `labels_not_ours` | Is the workflow's `runs-on` exactly `aih-fargate`, with no other label added in a list? |
| 200 with `repository_not_allowed` | Does `-c repositories` at deploy time match `owner/repo` exactly? Case matters |
| 200 with `not_from_app` | It is registered as a repository webhook. Make it the GitHub App's webhook |
| 200 with `fork` or `event_not_trusted` | As designed. Run that job on GitHub's runners |
| 500, and `GitHub answered 401` or `404` in the log | Check the app's client ID, private key, installation, and permissions (Administration, write) |
| 500, and `the overrides are ... characters` in the log | The JIT configuration is longer than RunTask allows. Switch to the other way of passing it in the verification notes |
| 500, and `RunTask started nothing` in the log | The reason follows it. Subnet addresses, the vCPU quota |
| The task started but the job did not | Read the runner's log group. Was the image pulled, and can GitHub be reached (only 443 goes out)? |
| A job fails at `docker` | No daemon can run on Fargate. See [Build, Continued](/en/chapters/62-ci-runners/more.md) |
| A job fails at the `aws` command | The image has no AWS CLI. Install it in the workflow or build an image |
| A job stops at 6 hours | The sweeper stopped it. `RUNNER.maxTaskSeconds` |
| After a while, runners stop taking jobs | The runner version is old. GitHub requires an update within 30 days. Update `RUNNER.image` |

This table was put together from the code and the documentation. None of it was provoked and observed.

## Before production

- **Separate by organization and runner group, not by repository.** GitHub's documentation recommends runner groups to bound which repositories can use which runners. Do not use the same app and the same cluster for repositories you trust differently
- **Put runners in an account that is not production.** The network and the quotas a job can reach are then separate from production's
- **Limit outbound traffic by domain name.** Use the options in [chapter 63](/en/chapters/63-agent-sandbox.md)
- **Pick up missed deliveries.** Run, on a schedule, something that looks up failed deliveries through the API and redelivers them
- **Receive through a queue.** A burst of deliveries runs into Lambda's concurrency and GitHub's API limits. Let the receiver only check the signature and enqueue, and move the launch to a worker (chapter 08). A limit on tasks running at once can be set there too
- **Replace the app's private key on a schedule.** Decide the procedure, and delete the old key on GitHub's side (chapter 21)
- **Automate image updates.** Have something notice a new release and open a pull request that updates the digest. Through a pull through cache, tasks can start while ghcr.io is down (chapter 52)
- **Turn failures into notifications.** Connect the receiving Lambda's errors, and the number of tasks the sweeper stopped, to alarms (chapter 19)
- **Decide how long job logs are kept.** The runner's log group holds the runner's own output. The job's log is on GitHub's side
- **Deploy through the AWS CDK CLI and CloudFormation.** cdkd's official documentation describes cdkd as a tool for development and testing and recommends the AWS CDK CLI for production (chapter 02)

## Cleanup

<!-- section: 62.cleanup -->

Stop GitHub's side first. Uninstall the GitHub App from the repository, or delete the app. Otherwise deliveries keep being sent to a URL that no longer exists after the stack is gone. Delete the app's private key on GitHub's side as well.

Make sure no task is running, then destroy the stack. Tasks are not resources of the stack, so a destroy does not stop them. Whether a cluster can be deleted while it has running tasks was not checked.

```bash
aws ecs list-tasks --cluster <ClusterName> --region ap-northeast-1
vp run runners:infra:destroy
```

The two secrets, the table, and the log groups are set to go with the stack, and a test checks that no resource is set to be retained. A Secrets Manager secret normally has a waiting period before deletion. Whether cdkd deletes it without one was not checked. After destroying, confirm with this command that none remains.

```bash
aws secretsmanager list-secrets --include-planned-deletion --region ap-northeast-1
```

On GitHub's side, registrations of runners that never connected may remain. An ephemeral runner's registration is removed automatically after a day. The list of runners in the repository's settings shows them.

Chapter 11's VPC can be destroyed once this chapter's stack is gone.

::: details Verification notes for this chapter

**Checked locally.** 95 unit tests (the signature, the decision, the order of failures in the receiver, the shape of the requests sent to GitHub's API, the RunTask input, the sweeper, the configuration, the workflow, cost, and the stack's assertions). The type check. `runners:infra:synth` (with no context, and with `-c repositories=example-org/notes -c appClientId=Iv23example`; `-c repositories='example-org/*'` is refused). `runners:decide` (the output on the [Deploy](/en/chapters/62-ci-runners/deploy.md) page is this command's actual output). The runner image's manifest was read anonymously from ghcr.io. The AWS amounts in the text are computed by `tools/src/pricing/calc.ts` from Price List unit prices, and `examples/62-ci-runners/test/pricing.test.ts` checks them.

**Not checked yet.** Nothing was run against AWS. GitHub's and GitLab's APIs were never called with credentials. No GitHub App was created, no runner was registered, and no job ran. So none of the following was observed: that cdkd 0.296.28 can create and delete this stack; that the function URL receives GitHub's deliveries; the real shape of a delivery (the tests' payload is hand-written); that `encoded_jit_config` fits in RunTask's override limit (8,192 characters); that the runner image starts on Fargate, runs one job, and exits; how long start-up takes (the one minute in the cost section is an assumption); that the receiver finishes in 9 seconds; that `head_repository` names the fork for a pull request from a fork; the DynamoDB condition expression; the sweeper stopping old tasks; the symptoms under "Pitfalls".

What primary sources did not settle. When `generate-jitconfig` answers 409. Whether a runner registered just in time gets default labels such as `self-hosted`. That the default runner group's ID is 1 (read from the API's example only). Whether a used JIT configuration can register again. A sentence stating that jobs on self-hosted runners can request an OIDC token (inferred from the values of `runner_environment`). The permission needed to register runners on an organization. Where caches written from self-hosted runners are stored. How a GitHub plan's included minutes are counted per kind of runner. A new start date for the charge on self-hosted runners. A sentence stating that a Fargate task cannot reach the underlying host's instance metadata. A maximum run time setting for a standalone task. On CodeBuild-hosted runners, how the service role's credentials appear to a job, and whether jobs from forks can be refused. Whether rootless BuildKit and Buildah work on Fargate (BuildKit's documentation gives a procedure that lifts the seccomp restriction and GitLab's one that does not; they differ). Whether GitLab has a way to use a webhook to start a runner per job (none was found, which is not the same as confirming there is none). Whether Cloudflare or Vercel has a way to bring your own build machine (one page of each was read). That a function URL has no extra charge (not found on the pricing page; only the 2022 launch blog says so).

GitLab, CodeBuild, ARC, runner scale sets, Cloudflare, and Vercel were read about only. The quotations from GitLab's documentation, about.gitlab.com, and Cloudflare's page were read through a summary and were not compared word for word with the original.

Resource types and cdkd. The registrations (`register("AWS::...")`) inside the `@go-to-k/cdkd` 0.296.28 package were checked: all 12 types this stack uses (`AWS::DynamoDB::Table`, `AWS::EC2::SecurityGroup`, `AWS::ECS::Cluster`, `AWS::ECS::TaskDefinition`, `AWS::IAM::Policy`, `AWS::IAM::Role`, `AWS::Lambda::Function`, `AWS::Lambda::Permission`, `AWS::Lambda::Url`, `AWS::Logs::LogGroup`, `AWS::Scheduler::Schedule`, `AWS::SecretsManager::Secret`) have a provider of their own. None goes through the Cloud Control API. Whether each provider handles the properties this stack uses (`InvokedViaFunctionUrl` on `AWS::Lambda::Permission`, a Lambda target on the Schedule, and so on) was not read.

Observed by synthesizing with aws-cdk-lib 2.273.0. `addFunctionUrl` with `authType: NONE` creates two `AWS::Lambda::Permission` resources: `lambda:InvokeFunctionUrl`, and `lambda:InvokeFunction` with `InvokedViaFunctionUrl`. The security group's egress rule is a property of the group and not a resource of its own.

What this chapter added to chapter 04's kit. Verifying the signature needs the body's bytes, so instead of `readJson` there is `readBytes` in `src/receive.ts`, which reads bytes up to a limit.

**Where the code is.**

| Section | Files | `vp run` tasks |
| --- | --- | --- |
| A runner executes whatever a workflow says | `examples/62-ci-runners/src/decide.ts`, `infra/test/runner-stack.test.ts` | `test:unit` |
| The whole picture | `examples/62-ci-runners/infra/lib/runner-stack.ts`, `src/config.ts` | `runners:infra:synth` |
| Registering a runner | `examples/62-ci-runners/src/github.ts`, `test/github.test.ts` | `test:unit` |
| Receiving a delivery | `examples/62-ci-runners/src/receive.ts`, `src/signature.ts`, `src/events.ts`, `src/app.ts`, `src/lambda.ts`, `test/signature.test.ts`, `test/receive.test.ts` | `test:unit`, `runners:decide` |
| Deciding whether to launch | `examples/62-ci-runners/src/decide.ts`, `test/decide.test.ts` | `test:unit`, `runners:decide` |
| One task for one job | `examples/62-ci-runners/src/claims.ts`, `src/dynamodb-claims.ts`, `src/launcher.ts`, `src/sweep.ts`, `src/sweeper.ts`, `src/sweeper-lambda.ts`, `test/launcher.test.ts`, `test/sweep.test.ts` | `test:unit` |
| The stack | `examples/62-ci-runners/infra/lib/runner-stack.ts`, `infra/bin/app.ts`, `infra/test/runner-stack.test.ts`, `workflows/ci.yml` | `runners:infra:synth`, `test:unit` |
| Check it locally | `examples/62-ci-runners/scripts/decide.ts`, `fixtures/workflow-job-queued.json`, `test/` | `runners:decide`, `test:unit` |
| Deploy | `examples/62-ci-runners/infra/bin/app.ts`, `tools/src/infra/` | `runners:infra:diff`, `runners:infra:deploy`, `runners:infra:drift` |
| Cost | `examples/62-ci-runners/src/cost.ts`, `test/pricing.test.ts`, `data/pricing/` | `test:unit` |
| Cleanup | `tools/src/infra/` | `runners:infra:destroy` |

**Primary sources** (all checked on 2026-10-13; sources checked for chapters 20, 21, and 41 carry their dates there)

- Registering runners: [REST API endpoints for self-hosted runners](https://docs.github.com/en/rest/actions/self-hosted-runners?apiVersion=2022-11-28), [Removing self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/remove-runners), [Self-hosted runners reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)
- GitHub Apps: [Generating a JSON Web Token (JWT) for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app), [REST API endpoints for GitHub Apps](https://docs.github.com/en/rest/apps/apps?apiVersion=2022-11-28), [Permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps?apiVersion=2022-11-28)
- Webhooks: [Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads), [Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [Handling failed webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries), [Best practices for using webhooks](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks), [github/rest-api-description](https://github.com/github/rest-api-description/blob/main/descriptions/api.github.com/api.github.com.yaml) (`webhook-workflow-job-queued`, `workflow-run`)
- Security: [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use), [Managing GitHub Actions settings for a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository), [OpenID Connect reference](https://docs.github.com/en/actions/reference/security/oidc)
- Autoscaling: [Actions Runner Controller](https://docs.github.com/en/actions/concepts/runners/actions-runner-controller), [actions/scaleset](https://github.com/actions/scaleset)
- The runner image: [images/Dockerfile of actions/runner v2.338.0](https://github.com/actions/runner/blob/v2.338.0/images/Dockerfile) and `src/Runner.Listener/CommandSettings.cs`, and the manifest of `actions/actions-runner:2.338.0` on ghcr.io
- Limits and prices (GitHub): [Actions limits](https://docs.github.com/en/actions/reference/limits), [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing), [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [Update to GitHub Actions pricing](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/), [Dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)
- GitLab: [Migrating to the new runner registration workflow](https://docs.gitlab.com/ci/runners/new_creation_workflow/), [Registering runners](https://docs.gitlab.com/runner/register/), [GitLab token overview](https://docs.gitlab.com/security/tokens/), [Executors](https://docs.gitlab.com/runner/executors/), [Instance executor](https://docs.gitlab.com/runner/executors/instance/), [Docker Autoscaler executor](https://docs.gitlab.com/runner/executors/docker_autoscaler/), [fleeting-plugin-aws](https://gitlab.com/gitlab-org/fleeting/plugins/aws), [Advanced configuration](https://docs.gitlab.com/runner/configuration/advanced-configuration/), [Long polling](https://docs.gitlab.com/ci/runners/long_polling/), [Autoscaling GitLab CI on AWS Fargate](https://docs.gitlab.com/runner/configuration/runner_autoscale_aws_fargate/), [Security for self-managed runners](https://docs.gitlab.com/runner/security/), [Merge request pipelines](https://docs.gitlab.com/ci/pipelines/merge_request_pipelines/), [Configure OpenID Connect in AWS](https://docs.gitlab.com/ci/cloud_services/aws/), [GitLab pricing](https://about.gitlab.com/pricing/), [Compute minutes FAQ](https://about.gitlab.com/pricing/faq-compute-minutes/)
- Image builds and caches: [Use Docker to build Docker images](https://docs.gitlab.com/ci/docker/using_docker_build/), [Build Docker images with BuildKit](https://docs.gitlab.com/ci/docker/using_buildkit/), [Use kaniko to build Docker images (removed)](https://docs.gitlab.com/ci/docker/using_kaniko/), [GoogleContainerTools/kaniko](https://github.com/GoogleContainerTools/kaniko), [BuildKit rootless mode](https://github.com/moby/buildkit/blob/master/docs/rootless.md), [Docker Machine Executor autoscaling configuration](https://docs.gitlab.com/runner/configuration/autoscale/)
- CodeBuild: [Configure a CodeBuild-hosted GitHub Actions runner](https://docs.aws.amazon.com/codebuild/latest/userguide/action-runner.html), [About CodeBuild-hosted GitHub Actions runners](https://docs.aws.amazon.com/codebuild/latest/userguide/action-runner-questions.html), [Configure a CodeBuild-hosted GitLab runner](https://docs.aws.amazon.com/codebuild/latest/userguide/sample-gitlab-runners.html), [About CodeBuild-hosted GitLab runners](https://docs.aws.amazon.com/codebuild/latest/userguide/gitlab-runner-questions.html), [ProjectEnvironment](https://docs.aws.amazon.com/codebuild/latest/APIReference/API_ProjectEnvironment.html), [Run builds on AWS Lambda compute](https://docs.aws.amazon.com/codebuild/latest/userguide/lambda.html), [AWS CodeBuild Pricing](https://aws.amazon.com/codebuild/pricing/)
- ECS and Fargate: [RunTask](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RunTask.html), [Ensuring idempotency](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/ECS_Idempotency.html), [ContainerOverride](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerOverride.html), [StopTask](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_StopTask.html), [Fargate security considerations](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-security-considerations.html), [Amazon ECS task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html), [IAM roles best practices for Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-iam-roles.html), [AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)
- Lambda and EC2: [Control access to Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html), [Invoking Lambda function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html), [Retrieve security credentials from instance metadata](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-metadata-security-credentials.html)
- Prices (AWS): the AWS Price List bulk API for [CodeBuild](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/CodeBuild/current/ap-northeast-1/index.json). Unit prices for Fargate, Lambda, DynamoDB, Secrets Manager, Scheduler, and public IPv4 addresses are the ones fetched for their own chapters
- Cloudflare and Vercel: [Workers Builds: limits and pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/), [Managing builds](https://vercel.com/docs/builds/managing-builds)
- cdkd v0.296.28: [src/provisioning/register-providers.ts](https://github.com/go-to-k/cdkd/blob/v0.296.28/src/provisioning/register-providers.ts) (checked in the installed package's registrations)
- [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) (observed by running the synthesis)

:::
