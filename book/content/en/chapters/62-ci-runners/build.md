---
title: "62 CI Runners: Design and Build"
---

# 62 CI Runners: Design and Build

This page reads the design from the [overview](/en/chapters/62-ci-runners.md) in the order things happen, from a delivery arriving to a task starting. It begins with how a runner registers with GitHub, because that decides what the receiver holds and what it hands to the task.

## Registering a runner

<!-- section: 62.registration -->

A runner is not a server that waits for GitHub to call it. The runner connects to GitHub over HTTPS and receives its job. What GitHub's documentation asks of the runner's host is that it can open outbound HTTPS connections on port 443. Nothing in it asks for inbound traffic, which is why the security group can allow nothing in.

Before it connects, a runner is registered. GitHub documents two ways.

One is the registration token. You create it through the API or the repository's settings and pass it to the runner's `config.sh`. It is valid for one hour. A runner configured with `--ephemeral` is unregistered after one job. This way the registration token is carried into the runner's environment, and the configuration step runs there.

The other is a just-in-time configuration. `POST /repos/{owner}/{repo}/actions/runners/generate-jitconfig` takes the runner's name, a runner group ID, and labels, creates the registration, and returns `encoded_jit_config`. The runner is simply started with `./run.sh --jitconfig <value>`; there is no configuration step. GitHub removes the registration once the runner has run at most one job. If it never connects, the registration of an ephemeral runner is removed automatically after one day (14 days for an ordinary runner).

This chapter uses the just-in-time configuration, because then all that enters the runner's environment is a single-use configuration for that one runner.

### Calling the API as a GitHub App

Calling `generate-jitconfig` takes the equivalent of administrator access to the repository. Instead of giving a Lambda someone's personal access token, create a GitHub App. An app suits this chapter in three ways: the app can own the webhook, its tokens expire after an hour, and each token can be narrowed to chosen repositories and permissions when it is issued.

Authentication has two steps. First the app's private key signs a JWT. GitHub requires RS256 and an expiry no more than 10 minutes ahead, and recommends an issue time 60 seconds in the past to allow for clock drift.

<<< @/examples/62-ci-runners/src/github.ts{jwt}

Then the JWT buys an installation access token. The delivery's payload carries `installation.id`, which says where the app is installed, and that is what is used.

<<< @/examples/62-ci-runners/src/github.ts{app}

The token is requested for the one repository the delivery names, with `administration: write` and `actions: read` only. The first is what `generate-jitconfig` and removing a runner need, the second what reading a workflow run needs (checked against the list of permissions required for GitHub Apps).

A caution belongs here. `administration: write` is not a permission to register runners only. It is the permission to change the repository's settings; the API describes it as covering repository creation, deletion, settings, teams, and collaborators. For runners registered on a repository there is nothing narrower. This app's private key therefore has to be treated as an administrator's key to the repository. The chapter keeps it in Secrets Manager, readable by the receiving Lambda's role and nothing else. There are APIs that register runners on an organization too; the chapter does not use them and did not check which permission they need.

To the receiver, GitHub is these three operations and no more.

<<< @/examples/62-ci-runners/src/github.ts{interface}

Tests hand in a stand-in for this interface. The real implementation (`gitHubApp`) is tested with `fetch` replaced, which checks only the shape of the requests it sends. GitHub's API was never called with credentials.

## Receiving a delivery

<!-- section: 62.receiver -->

Subscribing the GitHub App to the `workflow_job` event makes GitHub send a POST to the webhook URL each time a job changes state. The states are `queued`, `in_progress`, `completed`, and `waiting`; a runner is started only for `queued`.

Anyone can call this URL. The function URL's auth type is `NONE`, and it has to be, since GitHub cannot sign a request for IAM. Whether a delivery is genuine is settled by its signature. GitHub computes an HMAC-SHA256 of the request body, keyed with the secret set on the webhook, and puts it in the `X-Hub-Signature-256` header as hex prefixed with `sha256=`.

<<< @/examples/62-ci-runners/src/signature.ts{verify}

The comparison does not use `===` because GitHub's documentation asks for a constant-time comparison. If the response time showed how many leading characters matched, a signature could be guessed one character at a time. The function is tested with the values GitHub's documentation gives for checking an implementation: a secret, a payload, and the signature they produce.

The signature is computed over the bytes of the body. A body parsed as JSON and written out again would not match. So chapter 04's `readJson` is not used here, and this chapter has its own function that reads bytes up to a limit.

<<< @/examples/62-ci-runners/src/receive.ts{body}

The bytes are not interpreted, not even as JSON, until the signature matches. After that they go through a Valibot schema.

<<< @/examples/62-ci-runners/src/events.ts{delivery}

The schema copies, from the OpenAPI definition GitHub publishes (`webhook-workflow-job-queued`), only the fields the receiver reads. The payload has more than a hundred others; what is not read is not validated.

The whole of the receiver is this.

<<< @/examples/62-ci-runners/src/receive.ts{receive}

The order matters. Size limit, signature, event type, JSON, schema, decision: a delivery that fails one of them is answered there. A request whose signature does not match gets 401 whether or not its body is JSON, so that a caller without the secret learns nothing about what is wrong with the body.

The status codes are chosen for how they look on GitHub's side. GitHub records a delivery as failed when no 2XX arrives within 10 seconds. Failed deliveries are not redelivered automatically; someone redelivers them from the settings page or through the API. A delivery the receiver decides not to act on is therefore answered with 200 and a reason: it is the receiver's decision, not a failure. Only a launch that was attempted and failed is answered with 500. It then stays in the list of failures, and redelivering it tries again.

The receiving Lambda's timeout is 9 seconds. Stopping short of 10 avoids the case where GitHub has recorded a failure while the Lambda is still working. Whether three GitHub API calls and one RunTask fit in 9 seconds was not measured. If they often do not, let the receiver only put the delivery on a queue and move the launch to a worker as in [chapter 08](/en/chapters/08-async.md).

## Deciding whether to launch

<!-- section: 62.decision -->

The decision has two stages. The first needs only the delivery's payload.

<<< @/examples/62-ci-runners/src/decide.ts{screen}

The label check comes first because it is where most deliveries drop out. In a repository where the app is installed, deliveries for jobs that run on GitHub's runners (`ubuntu-latest` and the like) arrive at the same URL.

The label condition is that every label the job asks for equals the one label this chapter's runners carry. A job asking for `[self-hosted, aih-fargate]` gets no runner. GitHub gives a job to a runner that has all the labels the job asks for. Whether a runner registered just in time is given default labels such as `self-hosted` could not be confirmed, so a runner is started only for a job it is certain to be able to take. A runner started for a job it cannot take waits for a job that never comes.

The repository is checked against a list of exact names, and has to be private. Both can be read from the payload's `repository`.

The second stage tells jobs from forks apart. The `workflow_job` payload has no field that says which repository the code came from (checked in the OpenAPI definition). So the receiver reads, through the API, the workflow run the job belongs to.

<<< @/examples/62-ci-runners/src/events.ts{run}

<<< @/examples/62-ci-runners/src/decide.ts{admit}

A workflow run carries both the repository the workflow runs in (`repository`) and the repository the code came from (`head_repository`). For a pull request from a fork the two differ, and unless they are the same nothing is launched. That `head_repository` really names the fork for a fork's pull request was read from the documented definition only, not observed.

A refused job stays queued on GitHub's side. A job waiting for a self-hosted runner is cancelled automatically after 24 hours. If pull requests from forks need CI, the sound way is to run those jobs on GitHub's runners, with a different `runs-on`.

This decision does not replace GitHub's settings. Whether workflows run for pull requests from forks, and whether they need approval, is set on the repository: "Run workflows from fork pull requests" for private repositories, and the approval required of outside contributors for public ones. The receiver's decision is a second brake, so that no runner starts even when those settings have been loosened.

## One task for one job

<!-- section: 62.launch -->

The same delivery can arrive twice. A manual redelivery arrives again with the same `X-GitHub-Delivery` value. If two arrivals start two tasks, the second runner either keeps running with no job to take, or takes some other job that comes later. Both cost money.

So before launching, the receiver claims the job.

<<< @/examples/62-ci-runners/src/claims.ts{interface}

The implementation is the conditional write of [chapter 05](/en/chapters/05-dynamodb.md).

<<< @/examples/62-ci-runners/src/dynamodb-claims.ts{claims}

The key is the repository and the job's ID, not the delivery's ID. What has to hold is "one task for one job", not "one task for one delivery".

The second half of the condition is for a receiving Lambda that stops after claiming. A claim would remain with no task started, a redelivery would be refused as a duplicate, and the job would never get a runner. A claim that is still launching therefore carries a lease, and a claim whose lease has run out can be taken again. It is the same idea as the visibility timeout of [chapter 08](/en/chapters/08-async.md). The lease has to be longer than the receiving Lambda can run. A shorter one would take the claim from a Lambda that is still working, and two tasks would start. A test pins that relation.

<<< @/examples/62-ci-runners/src/config.ts{timing}

With the claim held, the receiver creates the registration and starts the task.

<<< @/examples/62-ci-runners/src/launcher.ts{input}

The JIT configuration is passed as the container's arguments. The task definition's `entryPoint` is `/home/runner/run.sh`, so a `command` of `--jitconfig` and the value is the startup GitHub documents. A task definition's `secrets` cannot be changed by a RunTask override (`ContainerOverride` has no `secrets`). What can differ per task is `command`, `environment`, and `environmentFiles`.

One premise of passing it this way is unconfirmed. RunTask allows 8,192 characters for the whole of `overrides`. How long `encoded_jit_config` is, the documentation does not say, and the API was not called, so it is not known. If it is too long, the code fails with the reason before anything is sent to ECS. The verification notes say how to pass it otherwise.

The value is visible to anyone who can call `ecs:DescribeTasks`, since it is recorded as the task's override. It registers one runner. Whether the same value can register again after that runner has connected was not confirmed. Keep the set of principals in the account that can call `DescribeTasks` small.

RunTask can report a failure inside a successful response.

<<< @/examples/62-ci-runners/src/launcher.ts{ecs}

When, for example, the subnet has no free address, the HTTP response is 200, `tasks` is empty, and the reason is in `failures`. Code that only waits for an exception would not notice that nothing started.

### When a launch fails

What the receiver cleans up depends on where it failed.

| Where it failed | What is left at that point | Cleanup |
| --- | --- | --- |
| Reading the workflow run, creating the registration | The claim | Release the claim, answer 500 |
| RunTask | The claim, and a registered runner with nowhere to run | Remove the registration, release the claim, answer 500 |
| Removing the registration | The same | Release the claim only, answer 500. GitHub removes the registration after a day |
| Recording the launch afterwards | A running task | Undo nothing, answer 200. The claim stays "launching" until its lease runs out |
| The Lambda stops right after claiming | A claim with a lease | A redelivery after the lease tries again |

The fourth row leads to a duplicate if left alone. The task is running but the claim still says launching, so redelivering the same delivery after the lease starts another. Nothing redelivers automatically, so it takes a person to cause it. Look for `claim not completed` in the log before redelivering.

The runner's name changes with every attempt.

<<< @/examples/62-ci-runners/src/decide.ts{name}

That is because what GitHub answers to a second registration under the same name could not be confirmed. `generate-jitconfig` lists a 409 among its responses, and the documentation does not say when. A new name each time means a registration left by an earlier attempt is never in the way.

`test/receive.test.ts` reproduces each of these orders, one at a time, with stand-ins.

### A runner does not necessarily take the job it was started for

A task starts because of one job's delivery, but it may not be that job it takes. GitHub gives a job to a runner whose labels match; it does not tie a runner to a job. When two jobs are queued at nearly the same moment, two runners start, and which takes which is not determined. As long as the number of jobs and the number of runners agree, that does no harm.

It does harm when the numbers stop agreeing. If a job is cancelled before its runner has started, the runner waits for a job that never comes. A Fargate task has no setting for a maximum run time (none was found in the documentation for standalone tasks or in the RunTask reference). So the sweeper Lambda stops old tasks.

<<< @/examples/62-ci-runners/src/sweep.ts{expired}

The limit is 6 hours, the same as the job limit on GitHub's runners. A task that is running a job is stopped at the limit too, which also puts a ceiling on what a runaway job can cost.

## The stack

<!-- section: 62.stack -->

The task has two roles, and neither can do much.

<<< @/examples/62-ci-runners/infra/lib/runner-stack.ts{roles}

The task role's credentials can be fetched from inside the container by asking a fixed address. Any permission on the task role is therefore usable by any command a job writes. That is why it is empty. A job that needs AWS does what chapter 20's workflows do: it sets `id-token: write`, asks for an OIDC token, and assumes a role whose trust policy checks the branch or the environment. That a job on a self-hosted runner can ask for an OIDC token was inferred from the token's `runner_environment` claim, one of whose values is `self-hosted`. No sentence in the documentation says so outright. To tighten a trust policy further, that claim can be added to its conditions.

When a runner runs on an EC2 instance, the same holds for the instance profile: a job can fetch the role's credentials from instance metadata.

<<< @/examples/62-ci-runners/infra/lib/runner-stack.ts{task}

The task definition contains no environment variable and no secret. The image is pulled straight from ghcr.io, so the execution role needs no ECR permission either. To avoid pulling from Docker Hub or ghcr.io directly, use the pull through cache of [chapter 52](/en/chapters/52-ecr.md).

<<< @/examples/62-ci-runners/infra/lib/runner-stack.ts{network}

Outbound traffic is not limited by destination. A security group filters by port and IP address only, and GitHub's hosts are given as domain names. On port 443 a job can connect anywhere. Keeping code and secrets from being carried out takes a way out that filters by domain name; the options and their monthly prices are in [chapter 63](/en/chapters/63-agent-sandbox.md).

The receiving Lambda's role is this.

<<< @/examples/62-ci-runners/infra/lib/runner-stack.ts{receiver-role}

`ecs:RunTask` allows starting this revision of this task definition, in this cluster, and nothing else. `iam:PassRole` allows handing the task's two roles to ECS, and nothing else. If the receiving Lambda were taken over, all it could start is this task with no permissions. It can, however, read the GitHub App's private key. This Lambda is the part of the design that most needs protecting.

<<< @/examples/62-ci-runners/infra/lib/runner-stack.ts{receiver}

<<< @/examples/62-ci-runners/infra/lib/runner-stack.ts{sweeper}

The sweeper's role can list the cluster's tasks and stop them, and that is all. `ecs:ListTasks` is an action that cannot name a resource, so `Resource` stays `*` and a condition fixes the cluster. Note that the response to `DescribeTasks` includes a task's overrides, so this role is in a position to read JIT configurations.

The allowed repositories and the app's client ID are passed as context at deploy time.

<<< @/examples/62-ci-runners/infra/bin/app.ts{context}

A stack deployed with neither refuses every delivery. An empty list allows nothing: the design fails in that direction.

On the workflow's side, only `runs-on` changes.

<<< @/examples/62-ci-runners/workflows/ci.yml

The difference from a workflow on GitHub's runners is the one `runs-on` line. The way into AWS is unchanged from chapter 20. The runner may be inside your own account; the job still assumes a role by the same steps as a job on a runner outside.

[Build, Continued](/en/chapters/62-ci-runners/more.md) looks at other ways to do the same, and at GitLab.
