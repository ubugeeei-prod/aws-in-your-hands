---
title: "63 Agent Sandbox: Deploy"
---

# 63 Agent Sandbox: Deploy

## Deploying

<!-- section: 63.deploy -->

The steps on this page were never run against a real AWS account, and no agent was ever started. The commands and their order are put together from the steps of the chapters this one builds on and from the pinned cdkd.

**Deploy to an account that is not production.** The invariant was checked against the policies attached to the task role. Resource-based policies in the same account were not looked at. In an account that holds no production data at all, what was not looked at is nothing to worry about. How to separate accounts is in [chapter 33](/en/chapters/33-production-readiness.md).

GitHub's side comes first. These three steps are not tasks of this book; they are done in GitHub's settings pages.

- Create a GitHub App with read and write on Contents and Pull requests as its only repository permissions, and install it on the repositories the agent may touch and no others
- In that repository's ruleset, on the default branch, require a pull request, set required approvals to one or more, and block force pushes
- Generate a private key for the app, and note its client ID and the installation's ID

The private key goes into Secrets Manager, under the name the stack defaults to. The value is JSON with four fields: `clientId`, `installationId`, `owner`, and `privateKey`. A secret costs USD 0.40 a month while it exists.

```bash
aws secretsmanager create-secret --region ap-northeast-1 --name aih/agent-sandbox/github-app --secret-string file://github-app.json
```

Delete `github-app.json` once the secret is made.

Deploy chapter 11's VPC with a way out. **Hourly billing starts here** (USD 48.91 a month for a NAT gateway). Nothing in this layout narrows egress from outside. Read [The egress allowlist](/en/chapters/63-agent-sandbox/more.md) before going on.

```bash
vp run net:infra:deploy -c egress=nat
```

Deploy this chapter's stack without a tag. Only the repository is created.

```bash
vp run sandbox:infra:deploy
```

Build the image and push it. This is the step that needs a Docker daemon.

```bash
vp run sandbox:bundle
vp run sandbox:image:build a1
vp run sandbox:image:push a1
```

Deploy with the tag and the allowed repositories.

```bash
vp run sandbox:infra:diff -c imageTag=a1 -c repositories=<owner>/<name>
vp run sandbox:infra:deploy -c imageTag=a1 -c repositories=<owner>/<name>
```

Before a Bedrock model from Anthropic is used for the first time, the account has to submit the use case form ([chapter 17](/en/chapters/17-ai.md)).

Start one task. **The model is billed from here.**

```bash
vp run sandbox:launch <owner>/<name> "Fix the typos in the README" --minutes 10 --budget 0.5
```

If the answer has a task ARN, a work branch, and a deadline, the task was started. If it says `refused`, the reason is with it. Follow the task's output with this command.

```bash
vp run sandbox:logs
```

The first thing to look for is whether Claude Code started: a `system` line with `init` means it did. If the task ended before one appeared, the sandbox may have failed to start. What is printed in that case was not checked, so read the first few lines of the log as they are. The last line is the one this chapter's program writes, `{"event":"job",...}`. If its `status` is `pull_request`, the URL is in it.

Check that the deadline works as well. Ask for a job that does not end, with a deadline of five minutes: two minutes before the deadline, that is after three minutes, the program in the task stops the agent. The last line's `status` is `deadline`, and nothing is pushed.

```bash
vp run sandbox:launch <owner>/<name> "Take an hour and explain every file, one at a time" --minutes 5
```

What this checks is the inner limit. The reaper acts only when the inner limit failed, so this step does not exercise it, and there is no step here that shows the reaper stopping a real task. A task the reaper stopped carries a reason such as `agent sandbox: deadline` in its `stoppedReason`. The reason a task stopped can be read with these commands.

```bash
aws ecs list-tasks --cluster <ClusterName> --region ap-northeast-1 --desired-status STOPPED
aws ecs describe-tasks --cluster <ClusterName> --tasks <task id> --region ap-northeast-1 --query "tasks[].stoppedReason"
```

That the model calls are in CloudTrail can be seen with this command.

```bash
aws cloudtrail lookup-events --region ap-northeast-1 --lookup-attributes AttributeKey=EventName,AttributeValue=InvokeModelWithResponseStream --max-items 5
```

The difference between the template and what exists is checked with the same task as in other chapters.

```bash
vp run sandbox:infra:drift
```

When you are done, go on to [Cleanup](/en/chapters/63-agent-sandbox/wrap.md). A NAT gateway is billed whether or not a single task is running.
