---
title: "63 Agent Sandbox: Costs, Pitfalls, and Cleanup"
---

# 63 Agent Sandbox: Costs, Pitfalls, and Cleanup

## Cost

<!-- section: 63.cost -->

Amounts are in USD for the Tokyo Region, on demand, before tax, with a month of 730 hours. The arithmetic is in [Pricing](/en/reference/pricing.md).

The bill has three parts: keeping the stack, running tasks, and the task's way out of its subnet.

Keeping the stack, in the default configuration, costs this.

| Item | Quantity | Unit price | Per month |
| --- | --- | --- | --- |
| Reaper invocations | 730 hours × 60 | 0.0000002 each | 0.01 |
| Reaper duration | 43,800 runs × 0.2 s × 0.25 GB (assumed) | 0.0000133334 per GB-second | 0.03 |
| Scheduler invocations | 43,800 | 0 for the first 14 million in the Price List | 0.00 |
| Image storage | 0.5 GB (assumed) | 0.10 per GB-month | 0.05 |
| Subtotal | | | **0.09** |

After Lambda's free allowance, what is left is the USD 0.05 of image storage. The reaper's duration and the image's size are assumptions: neither the function nor the image ever ran or existed, so nothing here was measured. The secret that holds the GitHub App's key is outside the stack and costs USD 0.40 a month.

A running task costs Fargate and the model.

| Item | Quantity | Unit price | Amount |
| --- | --- | --- | --- |
| Fargate vCPU (arm64) | 1 vCPU × 0.5 hours | 0.04045 per vCPU-hour | 0.02 |
| Fargate memory (arm64) | 4 GB × 0.5 hours | 0.00442 per GB-hour | 0.01 |
| Model input | 400 thousand tokens (assumed) | 1.10 per million | 0.44 |
| Cache read | 2 million tokens (assumed) | 0.11 per million | 0.22 |
| Cache write | 300 thousand tokens (assumed) | 1.375 per million | 0.41 |
| Model output | 60 thousand tokens (assumed) | 5.50 per million | 0.33 |
| One task of 30 minutes | | | **1.43** |

Fargate's share is USD 0.03, and USD 0.05 if the task runs to the 50-minute limit. The rest is the model, and every token count in the table is an assumption. No agent was ever run, so how many tokens a real job uses is not known. What the table does show is that nearly all of a task's cost is the model's, and the unit prices. The daily ceiling of USD 20 is about fourteen of these assumed tasks.

The way out costs what the table under [The egress allowlist](/en/chapters/63-agent-sandbox/more.md) says: USD 48.91 a month for a NAT gateway, USD 81.76 for four interface endpoints, USD 292.00 for Network Firewall. All of it is billed with no task running. The only part this chapter's stack creates, behind its flag, is the Bedrock runtime endpoint (USD 20.44). The rest is chapter 11's stack's bill.

So what decides the cost of this design is which way out you put in place. For trying it now and then, the cheap way is to put a NAT gateway in on the day and remove it the same day.

## Where it goes wrong

<!-- section: 63.pitfalls -->

Nothing in this section was observed on the real thing. It lists what the design and the documentation lead one to expect.

**The task does not start.** If the private subnet cannot reach ECR, the image cannot be pulled. That is what happens with chapter 11's VPC in its default configuration (no way out). The task's `stoppedReason` gives the reason.

**Claude Code ends without starting.** When the sandbox cannot start, `failIfUnavailable` keeps Claude Code from starting. Whether bubblewrap works inside Fargate was not checked, so this is the first thing to suspect. If it turns out not to work, removing `failIfUnavailable` and carrying on quietly means giving up the inner wall. Put an outer wall (Network Firewall or a proxy) in place first.

**A package install fails.** A package that fetches something from a host that is not on the allowlist fails. Pick the needed hosts one at a time out of the failures in the agent's log and add each with its reason. Before adding one, think about what could be sent to it.

**The model cannot be called.** The task role allows one pinned inference profile. If `ANTHROPIC_MODEL` and `-c model=...` disagree, the call is denied. It is also denied if the account has not submitted the use case form for Anthropic's models.

**The push is rejected.** The token expires an hour after it is made. The hour counts from when the launcher made it, so a slow start leaves less of it. The 50-minute limit is there for that, but a start that takes ten minutes uses up the margin. A ruleset that forbids creating the work branch at all rejects the push too.

**The pull request cannot be opened.** If creating the pull request fails after the push, the task ends as a failure and only the branch is left. If the GitHub App was not given the Pull requests permission, whether it is the token request that fails or this step was not checked. The branch has been pushed, so a person can open the pull request.

**A request is refused with `daily_budget_spent`.** The estimate comes from the Bedrock token counts of the whole account. If the same account uses Bedrock for something else, that is counted too. It does not happen when the sandbox has an account to itself.

## For production

<!-- section: 63.production -->

These are the practice settings to change, the most pressing first.

**Narrow egress from outside.** A NAT gateway alone does not narrow destinations from outside. To keep using this, put Network Firewall or a proxy in place. Whichever it is, the source of its rules is the list in `src/egress.ts`.

**Do not hand the token to the agent.** The shape Claude Code's documentation recommends is a proxy outside the agent's boundary that adds the Git credential. Then the agent cannot read the token. This chapter's design is one step weaker: it hands over a token whose loss does little harm.

**Separate the account and fence it with SCPs.** Give the sandbox an account of its own, and use the SCPs of Organizations to forbid the services that account has no use for ([chapter 33](/en/chapters/33-production-readiness.md)). Whoever widens an IAM role's settings still cannot get outside the SCP.

**Send the records where they cannot be deleted.** The log groups go with the stack (`RemovalPolicy.DESTROY`) and keep a month. In production, keep them, and send them somewhere the sandbox account's administrators cannot delete either, a bucket in another account for example. For CloudTrail too, do not rely on the 90 days of event history: create a trail and keep it in another account ([chapter 21](/en/chapters/21-security.md)).

**Put an alarm on the reaper.** If the reaper stops, the outer limit on time is gone. Run chapter 33's review over this stack and it reports two functions with no alarm, three log groups that go with the stack, and five wildcard resources. A test pins that result. In production, put [chapter 19](/en/chapters/19-observability.md)'s alarm on the reaper's errors and have it reach a person.

**Keep the image up to date.** Claude Code, the base image, and Git all get updates. The versions are pinned, so they stay old until you raise them. Each time you do, read the settings keys and flags in the documentation again. What this chapter says a flag means is what the documentation said on 2026-10-13.

**Narrow who can ask.** Whoever holds `lambda:InvokeFunction` can call the launcher. The request's text becomes the agent's instructions as it is. Who can call it is the same question as what the agent can be made to do.

## As a distributed system

<!-- section: 63.distributed -->

Three things hold state: ECS holds the list of tasks, GitHub holds the branches and pull requests, and CloudWatch holds the token counts. The launcher and the reaper hold none, and ask ECS every time.

**A duplicated request.** The same request arriving twice is treated as something that happens: the first answer is lost and the caller tries again. Two things prevent a second task: looking at the `startedBy` of the running tasks, and RunTask's `clientToken`. The first does not work in the moment when ECS's list does not yet return the new task. The API reference says the ECS API is eventually consistent, and that the result of a call may not be visible at once. The second catches that gap. The tests reproduce both orders.

**The concurrency limit is not exact.** The launcher reads how many tasks are running, then starts one. Two requests at the same moment can both read one and make three between them. The limit is a brake on cost, not a condition of correctness, so it is left that way. To make it exact, claim a slot with a conditional write from [chapter 05](/en/chapters/05-dynamodb.md) before starting.

**A task stopped part-way.** A task can stop in the middle of any step: the reaper stops it, Fargate stops it (chapter 41), the agent fails. What is left outside depends on where. After the clone, nothing. After the push and before the pull request, a branch. The work branch's name comes from the request's ID, so a leftover branch says which request it belongs to. Trying again with the same ID gets "already launched", with the stopped task's ARN, for as long as ECS remembers the `clientToken`; how long that is was not checked. Try again with a new ID. The branch's name changes with it, so it does not collide with what the earlier run left.

**The estimate's delay.** The daily budget is judged on a figure that arrives late. What is spent between passing the budget and stopping cannot be prevented. The ceiling does not mean "it always stops at this amount". It means "it stops once it notices this amount was passed".

**If the reaper stops.** The reaper runs independently every minute, so one failed run is made up by the next. If the function itself is broken, the outer limit on time is gone. What remains is the inner limit and the token's hour of life. A task whose token has expired can still call the model, but it cannot push.

## Cleanup

<!-- section: 63.cleanup -->

Make sure no task is running, then destroy the stack.

```bash
aws ecs list-tasks --cluster <ClusterName> --region ap-northeast-1
vp run sandbox:infra:destroy
```

The repository is set to go with its images, and the log groups go too. **If you want to keep the records, export them before you destroy.**

Four things are left outside the stack.

- **The way out in chapter 11's VPC.** If you put in a NAT gateway or endpoints, deploy chapter 11's stack again in its default configuration, or destroy it. This is where hourly billing continues
- **The secret with the GitHub App's key.** The stack did not create it, so it does not delete it. Until you delete it yourself, it goes on costing USD 0.40 a month
- **GitHub's side.** The app, its installation, the ruleset, and the branches and pull requests the agent made stay on GitHub. If you are not going to use the app, delete its private key in GitHub's settings
- **CloudTrail's event history.** The records of the model calls and of the tasks being started stay for 90 days, at no charge

::: details Verification notes for this chapter

**Checked locally.** 103 unit tests in 12 files (the launcher's decisions and duplicated requests, the allowlist evaluator and its two renderings, the limits and the reaper, the GitHub App JWT's signature and the token check, the agent's command, settings and environment, the task's steps, the policy evaluator, command assembly, cost, and the stack assertions). Three changes that break the invariant were put in (adding `sts:AssumeRole` and `s3:Get*` to the task role, passing the Git token into the agent's environment, pushing to the base branch on `origin`), eight tests were seen to fail, and the changes were taken out again. The type check. `sandbox:infra:synth` (with no tag, with `-c imageTag=a1 -c repositories=acme/notes`, and with `-c modelEndpoint=true -c exec=true` added; `-c exec=yes` and `-c model=jp.amazon.nova-2-lite-v1:0` are refused). `sandbox:plan`, `sandbox:policy` (the output in the text is taken from this command's real output), `sandbox:bundle`. `--dry-run` of the five operations in `scripts/ops.ts`. The AWS CLI flags were checked against the help of the AWS CLI in the Nix shell.

**Not checked yet.** Nothing was run against AWS. No agent was ever started, and neither the model nor GitHub's API was called. There was no Docker daemon, so the image was never built (the `Dockerfile` is unverified). So none of the following was checked on the real thing: that cdkd 0.296.28 can create and delete this stack; that the task starts; that Claude Code runs with a read-only root and three volumes; that the bubblewrap sandbox can start inside Fargate; that Claude Code can call Bedrock with the task role's two actions alone; that a run with `--bare` reads the administrator's settings file; that the Git credential helper configuration works as intended; the shape of the token GitHub returns, and how the ruleset takes effect; that the reaper stops a real task; how the CloudWatch token metrics relate to the bill; an ECS Exec session; the symptoms under "Where it goes wrong".

Not confirmed from a primary source: whether a Fargate task runs on Firecracker (the ECS pages read for this chapter name no technology); that the execution role's credentials cannot be fetched from inside the container (the documentation says the task role's credentials are given to the container and that the container agent and Fargate use the execution role, but the pages read do not say they cannot be fetched); whether `InputTokenCount` includes cached tokens, and what `ModelId` holds for a call through an inference profile; how late Bedrock's metrics arrive; whether CloudTrail's `RunTask` event keeps the values of overridden environment variables; whether an approval given with a GitHub App's token counts towards a ruleset's required approvals; whether `--max-budget-usd` estimates with Bedrock's prices; whether Git's empty `credential.helper` also empties the list of URL-scoped helpers (which is why an empty value is passed to both); what becomes of an ECS Exec session's record when the task role has no log permission; the prices and limits of Cloudflare's and Vercel's sandboxes (only their overview pages were read).

Resource types and cdkd. Checked by reading `dist/` of the installed `@go-to-k/cdkd` 0.296.28: `AWS::ECR::Repository`, `AWS::ECS::Cluster`, `AWS::ECS::TaskDefinition`, `AWS::EC2::SecurityGroup`, `AWS::EC2::SecurityGroupIngress`, `AWS::IAM::Role`, `AWS::IAM::Policy`, `AWS::Lambda::Function`, `AWS::Logs::LogGroup`, and `AWS::Scheduler::Schedule` have an implementation of their own registered. The task definition implementation's `handledProperties` include `Volumes`. `AWS::EC2::VPCEndpoint` has no implementation of its own, so with `-c modelEndpoint=true` it should go through the Cloud Control API, as chapter 11's endpoints do. A test pins that the default configuration and the `exec=true` configuration are made only of types and properties that have an implementation.

Observed about aws-cdk-lib 2.273.0 by synthesizing: `ecs.LogDrivers.awsLogs` and `fromEcrRepository` give the execution role `logs:CreateLogStream` and `logs:PutLogEvents` on the log group, the three pull actions on the repository, and `ecr:GetAuthorizationToken` (on `*`). They add nothing to the task role.

**Where the code is.**

| Section | Files | `vp run` tasks |
| --- | --- | --- |
| The whole picture | `examples/63-agent-sandbox/infra/lib/agent-sandbox-stack.ts`, `src/config.ts` | `sandbox:infra:synth`, `sandbox:plan` |
| The launcher's decision | `examples/63-agent-sandbox/src/job.ts`, `src/launcher.ts`, `src/ports.ts`, `test/job.test.ts`, `test/launcher.test.ts` | `sandbox:plan`, `test:unit` |
| Getting the repository in and out | `examples/63-agent-sandbox/src/github.ts`, `src/run.ts`, `test/github.test.ts`, `test/run.test.ts` | `test:unit` |
| Starting Claude Code | `examples/63-agent-sandbox/src/agent.ts`, `src/entry.ts`, `scripts/bundle.ts`, `Dockerfile`, `test/agent.test.ts` | `sandbox:bundle`, `sandbox:plan`, `test:unit` |
| The agent's role | `examples/63-agent-sandbox/src/policy.ts`, `scripts/policy.ts`, `test/policy.test.ts`, `infra/test/agent-sandbox-stack.test.ts` | `sandbox:policy`, `test:unit` |
| The egress allowlist | `examples/63-agent-sandbox/src/egress.ts`, `test/egress.test.ts`, `examples/11-network/src/config.ts` | `sandbox:plan`, `net:plan`, `test:unit` |
| Limits on time and money | `examples/63-agent-sandbox/src/limits.ts`, `src/reaper.ts`, `src/aws.ts`, `test/limits.test.ts`, `test/reaper.test.ts` | `test:unit` |
| Records, and the way in for a person | `examples/63-agent-sandbox/infra/lib/agent-sandbox-stack.ts`, `src/commands.ts`, `scripts/ops.ts` | `sandbox:logs`, `sandbox:exec` |
| Checking it locally | `examples/63-agent-sandbox/test/`, `scripts/plan.ts`, `scripts/policy.ts` | `test:unit`, `sandbox:plan`, `sandbox:policy`, `sandbox:infra:synth` |
| Deploying | `examples/63-agent-sandbox/infra/bin/app.ts`, `src/commands.ts`, `scripts/ops.ts`, `tools/src/infra/` | `sandbox:infra:deploy`, `sandbox:image:build`, `sandbox:image:push`, `sandbox:launch`, `sandbox:infra:drift` |
| Cost | `examples/63-agent-sandbox/test/pricing.test.ts`, `data/pricing/` | `test:unit` |
| Cleanup | `tools/src/infra/` | `sandbox:infra:destroy` |

**Primary sources** (all checked on 2026-10-13; sources confirmed in other chapters carry their dates there)

- Running Claude Code safely: [Securely deploying AI agents](https://code.claude.com/docs/en/agent-sdk/secure-deployment), [Choose a sandbox environment](https://code.claude.com/docs/en/sandbox-environments), [Configure the sandboxed Bash tool](https://code.claude.com/docs/en/sandboxing), [Configure permissions](https://code.claude.com/docs/en/permissions), [Permission modes](https://code.claude.com/docs/en/permission-modes)
- Running and configuring Claude Code: [Run Claude Code programmatically](https://code.claude.com/docs/en/headless), [CLI reference](https://code.claude.com/docs/en/cli-reference), [Settings reference](https://code.claude.com/docs/en/settings-reference), [Managed settings](https://code.claude.com/docs/en/managed-settings), [Advanced setup](https://code.claude.com/docs/en/setup), [Enterprise network configuration](https://code.claude.com/docs/en/network-config), [Track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking), [Monitoring](https://code.claude.com/docs/en/monitoring-usage), and [@anthropic-ai/claude-code](https://registry.npmjs.org/@anthropic-ai/claude-code) on the npm registry (`stable` is 2.1.287)
- Claude Code and Bedrock: [Claude Code on Amazon Bedrock](https://code.claude.com/docs/en/amazon-bedrock)
- Other places Claude Code runs: [Use Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web), [Self-hosted environments](https://code.claude.com/docs/en/self-hosted-environments), [Hosting the Agent SDK](https://code.claude.com/docs/en/agent-sdk/hosting)
- ECS and Fargate: [RunTask](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RunTask.html), [ContainerOverride](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerOverride.html), [StopTask](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_StopTask.html), [Best practices for IAM roles in Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-iam-roles.html), [Fargate security considerations](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-security-considerations.html), [ECS Exec](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-exec.html), [Use bind mounts with Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/bind-mounts.html)
- Bedrock: [interface VPC endpoints](https://docs.aws.amazon.com/bedrock/latest/userguide/vpc-interface-endpoints.html), [CloudWatch metrics](https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-runtime-metrics.html), [CloudTrail](https://docs.aws.amazon.com/bedrock/latest/userguide/logging-using-cloudtrail.html), [AgentCore Runtime sessions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html)
- Egress: [Stateful domain list rule groups](https://docs.aws.amazon.com/network-firewall/latest/developerguide/stateful-rule-groups-domain-names.html), [RulesSourceList](https://docs.aws.amazon.com/network-firewall/latest/APIReference/API_RulesSourceList.html), [AWS Network Firewall Pricing](https://aws.amazon.com/network-firewall/pricing/), [How Resolver DNS Firewall works](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver-dns-firewall-overview.html)
- IAM actions and resource types: the AWS Service Reference for [ecs](https://servicereference.us-east-1.amazonaws.com/v1/ecs/ecs.json), [cloudwatch](https://servicereference.us-east-1.amazonaws.com/v1/cloudwatch/cloudwatch.json), [bedrock](https://servicereference.us-east-1.amazonaws.com/v1/bedrock/bedrock.json), and [secretsmanager](https://servicereference.us-east-1.amazonaws.com/v1/secretsmanager/secretsmanager.json)
- GitHub: [Create an installation access token for an app](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app), [Generating a JSON Web Token (JWT) for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app), [Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation), [Create a pull request](https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request), [Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- Git: [gitcredentials](https://git-scm.com/docs/gitcredentials), [git-config](https://git-scm.com/docs/git-config)
- Prices: the AWS Price List bulk API for [Network Firewall](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSNetworkFirewall/current/ap-northeast-1/index.json). The unit prices of Fargate, Lambda, ECR, NAT gateways, endpoints, public IPv4 addresses, EC2, Bedrock, and Secrets Manager are the ones each chapter fetched
- Cloudflare and Vercel: [Sandboxes on Cloudflare](https://developers.cloudflare.com/sandbox/), [Vercel Sandbox](https://vercel.com/docs/sandbox)
- cdkd: `dist/` of the installed [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)
- [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) (observed by running synth)

:::
