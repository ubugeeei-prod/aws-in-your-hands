---
title: "63 Agent Sandbox: Build, Continued"
---

# 63 Agent Sandbox: Build, Continued

The [previous page](/en/chapters/63-agent-sandbox/build.md) followed a request until it was a task with Claude Code running in it. This page goes through what surrounds that task from outside: the IAM role the agent holds, the way out of the network, the limits on time and money, the records, and the way a person gets in.

## The agent's role

<!-- section: 63.role -->

A task has two roles. As [chapter 12](/en/chapters/12-containers.md) showed, the execution role is what ECS and Fargate use to pull the image and write logs, and the task role is what the code inside the container uses. By the ECS documentation, the task role's credentials can be fetched from a fixed address inside the container. Any command the agent runs can use them. What is attached to the task role is exactly what the agent may do in AWS.

<<< @/examples/63-agent-sandbox/infra/lib/agent-sandbox-stack.ts{task-role}

There are two statements: calling the pinned inference profile, and calling the models behind it only by way of that profile. It is the same shape as [chapter 36](/en/chapters/36-bedrock.md), and a model cannot be called directly. The documentation says Claude Code uses Bedrock's Invoke API, so the actions are `InvokeModel` and `InvokeModelWithResponseStream`.

The IAM policy in the documentation also lists `ListInferenceProfiles` and `GetInferenceProfile`. They are for discovering profiles, and the page says Claude Code goes on without checking when discovery is unavailable. This chapter leaves them out. That Claude Code starts without them was not checked, and the [verification notes](/en/chapters/63-agent-sandbox/wrap.md) say how to pick that up.

There is no permission to write logs either. The container's standard output is written to CloudWatch Logs by the `awslogs` log driver, with the execution role. The agent has no permission that touches its own record.

The invariant is about this role. **Nothing the agent can do from inside reaches production data or the deploy role.** It is checked by reading the synthesized template, with a small policy evaluator written for the purpose.

<<< @/examples/63-agent-sandbox/src/policy.ts{statements}

The evaluator collects the statements attached to one role in a template: inline policies, and `AWS::IAM::Policy` resources. What it cannot read it does not skip silently; it puts it in `unread`. A managed policy lives outside the template, so its contents cannot be read. `NotAction` and `NotResource` are not handled. A role with anything in `unread` does not count as checked.

ARNs are in the template as the intrinsic functions CDK wrote.

<<< @/examples/63-agent-sandbox/src/policy.ts{render}

`Ref` and `Fn::GetAtt` become a placeholder string that stands for one resource of this stack. A placeholder matches no real ARN, so "allowed on this stack's table" can never look like "allowed on a table in another account".

There is one question.

<<< @/examples/63-agent-sandbox/src/policy.ts{can}

What the function answers is whether these statements could allow the action. Conditions are not evaluated: an Allow with a condition counts as allowed, and a Deny with a condition counts as absent. It errs towards reach, so "no" means no statement gets there, and "yes" means one might.

**This is not IAM.** IAM's real decision also involves resource-based policies, permissions boundaries, the SCPs of Organizations, and session policies ([chapter 21](/en/chapters/21-security.md)). The evaluator sees only the policies this stack attached to the role. If a bucket policy in the same account named this role and allowed it, the evaluator would not see that. That is one reason to put the sandbox in an account separate from production. Claude Code's documentation, too, recommends a dedicated AWS account, to simplify cost tracking and access control.

The tests ask the synthesized stack's task role, one at a time, about the things it must not reach. This task shows the same locally.

```bash
vp run sandbox:policy
```

The task role's part of the output, and the probes at the end, look like this (taken from the command's real output; the account IDs are made up, one for the sandbox and one for production).

```text
TaskRole30FC0FBB
  Allow bedrock:InvokeModel, bedrock:InvokeModelWithResponseStream
      on arn:aws:bedrock:ap-northeast-1:111111111111:inference-profile/jp.anthropic.claude-haiku-4-5-20251001-v1:0
  Allow bedrock:InvokeModel, bedrock:InvokeModelWithResponseStream  (with a condition, not evaluated)
      on arn:aws:bedrock:ap-northeast-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0
      on arn:aws:bedrock:ap-northeast-3::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0

Could the agent's role be allowed to...
  no   sts:AssumeRole on arn:aws:iam::999999999999:role/aih-deploy
  no   dynamodb:GetItem on arn:aws:dynamodb:ap-northeast-1:999999999999:table/notes
  no   s3:GetObject on arn:aws:s3:::aih-attachments/owner/file
  no   secretsmanager:GetSecretValue on arn:aws:secretsmanager:ap-northeast-1:111111111111:secret:aih/agent-sandbox/github-app-AbCdEf
  no   ecs:RunTask on arn:aws:ecs:ap-northeast-1:111111111111:task-definition/any:1
  no   iam:PassRole on arn:aws:iam::111111111111:role/any
```

Beyond this, the tests check that only ECS tasks can assume the task role, that only the launcher's role can pass it (`iam:PassRole`), and that only the launcher's role can read the GitHub App's key. Wildcard resources are counted with [chapter 33](/en/chapters/33-production-readiness.md)'s rule, imported as a workspace dependency. There are five in the whole stack and none on the task role: `ecr:GetAuthorizationToken` on the execution role, and `ecs:ListTasks` and `cloudwatch:GetMetricData` on each of the two functions. `ecs:ListTasks` is narrowed to the cluster by a condition.

## The egress allowlist

<!-- section: 63.egress -->

A task may reach four destinations.

<<< @/examples/63-agent-sandbox/src/egress.ts{allowlist}

The model's destination is the Bedrock runtime endpoint of the Tokyo Region. An inference profile may route a request to another Region, but that happens inside Bedrock; the only endpoint the task talks to is Tokyo's. GitHub has one name for Git traffic and another for its API. The package registry is npm's.

What is not on this list is out of reach. A package that fetches a binary from another host while it installs will fail. Add the hosts a repository needs, each with its reason. Every addition is one more place the agent can send what it has read. Claude Code's documentation warns that allowing a broad domain such as `github.com` can itself be a path for exfiltration: with a token that can push to GitHub and a route to GitHub, an attempt to send to another repository is possible. That is one more reason the token is limited to one repository.

The function that evaluates the list is this chapter's own.

<<< @/examples/63-agent-sandbox/src/egress.ts{allows}

The rules are kept short. Port 443 only. A host name either matches an entry exactly or sits under an entry that begins with a dot. An IP address is not a name, so it never matches. Given a URL, the function also requires `https:` and no credentials in the URL: `https://github.com@evil.example/` goes to `evil.example`. The tests include names that merely contain an allowed one (`github.com.evil.example`, `evilgithub.com`), and Bedrock in another Region, STS, and S3, all refused.

The same list is written out in the forms of the two mechanisms that enforce it.

<<< @/examples/63-agent-sandbox/src/egress.ts{renderings}

One is the Claude Code sandbox setting from the previous page. The other is a domain list rule for AWS Network Firewall. Because there is one list, the inner wall and the outer wall cannot come to say different things.

What actually stands as the outer wall is the decision that moves this chapter's bill the most. The task runs in a private subnet with no public IP address. Its security group allows nothing in, and only port 443 out.

<<< @/examples/63-agent-sandbox/infra/lib/agent-sandbox-stack.ts{network}

A security group cannot name a domain. Which hosts a task reaches on port 443 is decided by the routes out of the subnet. These are the choices, with what each costs a month just for being there (Tokyo, 730 hours, charges by data volume not included).

| Way out | What the task can reach | USD a month |
| --- | --- | --- |
| None (chapter 11's default) | The S3 gateway endpoint only. Not even the image can be pulled | 0 |
| Four interface endpoints | The Bedrock runtime, ECR, CloudWatch Logs. Not GitHub, not the registry | 81.76 |
| A NAT gateway | Every host that answers on port 443 | 48.91 |
| A proxy you run | The host names the proxy allows | 11.53, plus running it |
| Network Firewall with a NAT gateway | Hosts whose TLS SNI is on the list | 292.00 |

With **no way out**, a task does not start: Fargate pulls the image from ECR every time ([chapter 41](/en/chapters/41-fargate.md)).

**Interface endpoints alone** are the tightest way out, because there is no route to the internet at all. The two ECR endpoints and CloudWatch Logs are an option of chapter 11's stack (`-c interfaceEndpoints=ecr.api,ecr.dkr,logs`), and the Bedrock runtime endpoint is a flag of this chapter's stack (`-c modelEndpoint=true`, USD 20.44 a month). But this layout reaches neither GitHub nor the registry, so this chapter's flow of cloning and pushing does not work in it as it stands. It could, if the repository were handed over through S3 and the pull request were opened from outside; that is not built here.

With **a NAT gateway** (chapter 11's `-c egress=nat`), this chapter's flow works. The outer wall, however, becomes "anywhere, on port 443". The only thing narrowing destinations is the inner wall, Claude Code's sandbox. **This chapter's stack combined with chapter 11's NAT gateway and nothing more does not enforce the egress allowlist from outside.** It is the layout you get when you only want to try things, and it should be used knowing that.

**Network Firewall** is the way to build an outer allowlist from AWS services alone. By the documentation, a domain list rule reads the SNI of the TLS handshake for HTTPS and drops traffic to names that are not on the list. It does not look at IP addresses, and the page says to write separate IP rules where the SNI may be manipulated. It costs USD 0.395 per endpoint per hour, USD 288.35 for a month. By the pricing page, the hourly and data processing charges of a NAT gateway in the same path are waived, up to the amount charged for the firewall. The table's figure adds the Elastic IP address. `vp run sandbox:plan` prints the rule's content. It is not in the stack, because the firewall's subnets and the routes from the private subnets to the firewall belong to chapter 11's stack.

**A proxy** is the layout Claude Code's documentation gives for cloud deployments: the agent's containers in a subnet with no internet gateway, all outbound traffic through a proxy, and the proxy enforcing a domain allowlist and keeping a log. The monthly charge is one small instance, but choosing the proxy software, updating it, and noticing when it stops become your work. The documentation adds cautions: to the proxy, HTTPS traffic is a tunnel it cannot see into, with only the destination's name visible; and not every program obeys `HTTPS_PROXY`. It is not built here.

Route 53 Resolver DNS Firewall is not in the table. By the documentation it filters on the name in DNS queries only, and does not see the HTTPS traffic itself. A connection to a bare IP address goes straight past it.

The endpoint made by the `modelEndpoint` flag has a policy.

<<< @/examples/63-agent-sandbox/infra/lib/agent-sandbox-stack.ts{model-endpoint}

An endpoint policy decides which calls through that endpoint are allowed: by whom, with which actions, on which resources. The default allows everything. This one lets through only the task role calling the pinned model. It says what the IAM role says once more on the network side, but if someone widens the role's settings, this endpoint does not widen with them.

## Limits on time and money

<!-- section: 63.limits -->

The limits are in two places, inside and outside.

Inside are the Claude Code flags from the previous page. `--max-turns` and `--max-budget-usd` are counted by the agent's own process, which stops itself. The task's program also sends SIGTERM to the agent's process two minutes before the deadline. By the documentation, Claude Code on SIGTERM ends the process tree of a running command and exits with code 143.

An inner limit has its keeper and its subject in the same container. So there are outer ones as well.

<<< @/examples/63-agent-sandbox/src/limits.ts{reap}

The reaper stops three kinds of task: one past its deadline, one still running after the day's budget is spent, and one the launcher did not start. The last is a task found in the cluster that nobody recognizes. A task whose deadline cannot be read cannot be held to one, so it is stopped.

<<< @/examples/63-agent-sandbox/src/reaper.ts{sweep}

EventBridge Scheduler starts the reaper every minute. A task can outlive its deadline by a minute at the most, plus the 30 seconds of the stop: ECS's StopTask sends the container SIGTERM, and SIGKILL 30 seconds later. When no task is running, the reaper ends without asking CloudWatch anything. When one task will not stop, it still goes on to the others, and what would not stop is left as an error of the function. The next run tries again a minute later.

The money limit is estimated from the metrics Bedrock publishes to CloudWatch.

<<< @/examples/63-agent-sandbox/src/aws.ts{tokens}

<<< @/examples/63-agent-sandbox/src/limits.ts{spend}

By the Bedrock documentation, the `AWS/Bedrock` namespace carries the counts of input, output, cache-read, and cache-write tokens, published both with the `ModelId` dimension and without it. The reaper sums the ones without: the account as a whole. If the sandbox is all that uses Bedrock in the sandbox's account, that is the sandbox's usage. The prices are the ones [chapter 36](/en/chapters/36-bedrock.md) recorded from the Price List.

The estimate is rough. It lags by however long the metrics take to arrive, which was not checked. It prices every token in the account as the pinned model's. Whether `InputTokenCount` includes cached tokens could not be learned from the documentation; if it does, the sum comes out high, and a high sum only stops things sooner. The default ceiling is USD 20 a day. Past it, the launcher refuses new requests and the reaper stops every running task.

Apart from this, put a budget on the account ([chapter 32](/en/chapters/32-limits.md)). A budget's figure is refreshed only a few times a day, though. It will not stop a runaway task. It is for noticing that the month's total has gone past what you expected.

The task's hours come to little even at the limit: a task of 1 vCPU and 4 GB running for 50 minutes is about USD 0.05. At most two tasks run at once. The agent cannot call the launcher, but a script on the requesting side might run away, and this is the brake on that.

## Records

<!-- section: 63.audit -->

What happened is kept where the agent cannot rewrite it. The records are in three places.

The task's standard output goes to CloudWatch Logs.

<<< @/examples/63-agent-sandbox/infra/lib/agent-sandbox-stack.ts{logs}

With `--output-format stream-json`, Claude Code writes each tool call and its result to standard output, one per line, and the text of a command it ran is in there. The execution role does the writing, and the task role has no permission on the log group at all. The tests check that the task role is allowed neither `logs:PutLogEvents` nor `logs:DeleteLogStream`.

This record has a limit. The lines on standard output are written by a process in the same container as the agent. The agent cannot delete a line that has been sent, but nothing outside guarantees that everything that ran in the container became a line.

Model calls are in CloudTrail. By the Bedrock documentation, `InvokeModel` and `InvokeModelWithResponseStream` are logged as management events. By the ECS documentation, the `userIdentity` of a call from a task is the assumed role's name followed by the task's ID. Which task called which model, and when, is known without relying on anything inside the container. CloudTrail's event history holds 90 days ([chapter 21](/en/chapters/21-security.md)). The prompts and responses themselves are not in CloudTrail. To keep them, turn on Bedrock's model invocation logging ([chapter 36](/en/chapters/36-bedrock.md)), which is off by default.

The launcher's decisions are in the launcher's log group. A refused request is one line too, with its reason. The request's text is not written. Starting and stopping a task are in CloudTrail as `RunTask` and `StopTask`.

Claude Code can also send its events over OpenTelemetry. This chapter does not use that, because it adds one more part, the collector they are sent to.

## The way in for a person

<!-- section: 63.entry -->

A task has no way in from outside. The security group allows nothing inbound, and there is no public IP address, no SSH, no open port. When a person has to look inside a running task, the means is ECS Exec, which, as [chapter 41](/en/chapters/41-fargate.md) showed, is Systems Manager's Session Manager underneath.

In this chapter's stack it is off by default, and on only when the context carries `-c exec=true`.

<<< @/examples/63-agent-sandbox/infra/lib/agent-sandbox-stack.ts{exec}

Turning it on costs two things. ECS Exec's agent writes files into the container, so the root file system cannot be read-only, and the premise that the agent cannot rewrite its own settings file is gone. And the task role gains four `ssmmessages` actions. The agent holds the task role, so the agent holds those four as well. The tests check that these four are all the flag adds.

Who entered is in CloudTrail's `ExecuteCommand` event. What they typed afterwards can be kept by ECS Exec's feature that sends commands and output to CloudWatch Logs or S3. This chapter's stack does not give the task role the permission that needs, because that would let the agent write to a log. What becomes of the session's record without it was not checked.

So treat ECS Exec as something to switch on only while there is something to investigate. When you are done, deploy again without the flag.
