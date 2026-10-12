---
title: "62 CI Runners: Self-Hosted GitHub Actions and GitLab Runners on AWS"
sourceRevision: 1
---

# 62 CI Runners: Self-Hosted GitHub Actions and GitLab Runners on AWS

The workflows of [chapter 20](/en/chapters/20-shipping.md) ran on runners that GitHub provides and entered AWS by OIDC. This chapter runs the runner in your own AWS account. One fact decides everything: a runner executes whatever a workflow says. A runner of your own therefore has to be an environment that is made for one job, holds no permission, and is gone when the job ends. Every part of this chapter's design follows from that condition.

What you build is the smallest such design for GitHub Actions. A Lambda function receives the webhook that says a job was queued, checks its signature and its contents, and starts one Fargate task. The task runs one job and ends. How to do the same for GitLab, and the other ways GitHub and AWS offer, are described from their documentation in [Build, Continued](/en/chapters/62-ci-runners/more.md).

The stack has nothing that is billed by the hour. In a month without a single job it costs USD 0.80 for two secrets, plus a fraction of a cent. While a job runs, one task costs about USD 0.0020 a minute (Tokyo, 2 vCPU, 8 GB, arm64; the breakdown is under [Cost](/en/chapters/62-ci-runners/wrap.md)).

This chapter's design has never actually run. No GitHub App was created, no runner was registered, and no job was executed. What was checked locally is the tests, the type check, and the synthesis. What the chapter says about GitHub and GitLab is what their official documentation said on 2026-10-13. What could not be confirmed is collected in the [verification notes](/en/chapters/62-ci-runners/wrap.md).

You need OIDC from [chapter 20](/en/chapters/20-shipping.md), the VPC from [chapter 11](/en/chapters/11-network.md), Fargate from chapters [12](/en/chapters/12-containers.md) and [41](/en/chapters/41-fargate.md), and secrets from [chapter 21](/en/chapters/21-security.md). The code is in `examples/62-ci-runners/`.

## Reasons to run your own runner, and reasons not to

<!-- section: 62.when -->

A runner that GitHub provides runs each job in a new virtual machine and discards it afterwards. There is nothing for you to operate. People run their own all the same, for roughly four reasons.

- **The job has to reach into a VPC.** Running a migration against a database in a private subnet, or tests against an internal endpoint, cannot be done from a runner outside
- **You want to choose the size or the architecture.** GitHub's standard Linux runner has 2 cores and 8 GB for a private repository. Larger runners exist on paid plans; with your own you choose any size in Fargate's table
- **The volume is large.** A minute costs less on this chapter's design than at GitHub's list price. As [Cost](/en/chapters/62-ci-runners/wrap.md) works out, the difference only repays the operating effort once you use tens of thousands of minutes a month
- **Code or data may not leave a place you decided on.** Build intermediates and test data stay inside your account

The cases for not doing it are more common. For public repositories, GitHub's documentation says self-hosted runners should almost never be used; the next section explains why. If your usage fits within the minutes your plan includes (2,000 on Free, 3,000 on Team), running your own does not lower the bill. And if all you need is to reach into a VPC, consider moving only the step that needs it before moving whole jobs: a migration can be a one-off task as in [chapter 16](/en/chapters/16-long-jobs.md), which the workflow merely starts.

Once you have decided to run your own, there is still a way to write no code. AWS CodeBuild can run GitHub Actions and GitLab runners as a disposable build environment per job. This chapter builds its own instead in order to show registration, the webhook, the launch, and the cleanup one by one. Before using it for real, read the comparison in [Build, Continued](/en/chapters/62-ci-runners/more.md).

## A runner executes whatever a workflow says

<!-- section: 62.rule -->

Anyone who can push to a repository can rewrite its workflow files. Anyone who can open a pull request can rewrite the workflows on their own branch. The runner executes the commands written there with whatever the place it runs in can reach: from inside the VPC if it is in one, with an IAM role if it has one.

GitHub's secure use reference puts it this way (read on 2026-10-13). Self-hosted runners have no guarantee of running in ephemeral clean virtual machines, and can be persistently compromised by untrusted code in a workflow. They should almost never be used for public repositories, because anyone can open a pull request and compromise the environment. For private repositories, anyone who can fork the repository and open a pull request can do the same. GitLab's documentation likewise says the risk is more acute when runners that are reused between jobs are shared by several projects.

This chapter's invariant is one sentence. **Nothing a job wrote is visible to the next job.** That covers files, and also processes, memory, network settings, and cached credentials.

Designs that break it are common.

- **A long-lived runner.** One runner installed on an EC2 instance and left running. Files and processes left by one job are there for the next
- **A container per job on a shared host.** The containers are separate, but a job that is handed the Docker socket can operate the host and the other containers. So can a privileged container
- **A script that cleans up after each job.** The thing doing the cleaning is the environment that may have been compromised

Of systems that destroy the runner after each job, GitHub also warns that there is no way to guarantee a runner only runs one job. The mechanism made for that is the just-in-time runner (JIT runner). A runner whose registration was created first through the API, and which was started with that configuration, is removed by GitHub once it has run at most one job. The same document also says that re-using hardware to host JIT runners can expose information. A registration that works once and an environment that is used once are different things, and the second is yours to provide.

This chapter makes the environment a Fargate task. The ECS documentation says each Fargate task has its own isolation boundary and shares no kernel, CPU, memory, or network interface with another task. When the task ends, the environment is gone.

Five more rules follow from the same premise. The chapter's code and tests answer each.

- **No runner for a job from a fork, or for a public repository.** The allowed repositories are a list of exact names; a wildcard is not accepted
- **The runner's role is not the deploy role.** The task role has no permission at all. A job that needs AWS assumes a role by OIDC, as in chapter 20. That role's trust policy looks at the branch and the environment, so rewriting the workflow is not enough to assume the production role
- **No long-lived registration secret in the runner's environment.** Only the receiving Lambda reads the GitHub App's private key; the task gets a single-use JIT configuration and nothing else
- **Outbound traffic is limited.** The security group allows nothing in and only HTTPS out
- **The image does not grow stale.** The runner image is pinned by digest and updated when a release appears. GitHub requires an update within 30 days of a new version

The conditions for a job that may get a runner are one type.

<<< @/examples/62-ci-runners/src/decide.ts{policy}

`pull_request_target` is left off the list because a workflow started by that event runs with the base repository's privileges even for a pull request from a fork. GitHub's documentation says such a workflow must not check out untrusted code. The receiver cannot see what a workflow does, so it refuses the event altogether.

## The whole picture

<!-- section: 62.architecture -->

```figure
caption: When a job is queued, the GitHub App's webhook reaches the receiving Lambda. The Lambda checks the signature and the contents, claims the job, creates a single-use registration, and starts one Fargate task
type: sequence
actor gh: GitHub
actor fn: Receiver | Lambda, function URL
actor ddb: DynamoDB | claims
actor ecs: ECS | Fargate
step gh -> fn: workflow_job (queued)
step fn -> fn: signature, payload, policy
step fn -> ddb: conditional write
step fn -> gh: read workflow run
step fn -> gh: generate-jitconfig
step gh --> fn: encoded_jit_config
step fn -> ecs: RunTask
step ecs -> gh: runner connects
step gh --> ecs: one job
note ecs: task ends with the job
```

```figure
caption: What a job can reach. The task role is empty, and AWS is entered only through a role assumed by OIDC. The GitHub App's private key is on the Lambda's side and cannot be read from the task
node job: Job | Fargate task
node role: Task role | no permissions
node sg: Security group | nothing in, 443 out
node gh: GitHub | jobs, OIDC token
node sts: AWS STS | AssumeRoleWithWebIdentity
node deploy: Chapter 20's role | scoped to branch and environment
node key: GitHub App private key | Secrets Manager
node fn: Receiving Lambda
edge job -> role
edge job -> sg
edge sg -> gh: HTTPS
edge job -> sts: OIDC token
edge sts --> deploy: one-hour credentials
edge fn -> key: GetSecretValue
edge job -x key: no permission
mark job
```

There are few parts. The receiving Lambda is public through a function URL and takes GitHub's deliveries. The DynamoDB table remembers which jobs a runner was started for, so that a delivery that arrives twice starts one task. The ECS cluster and task definition are where the runner runs. One more Lambda, the sweeper, runs every 15 minutes and stops tasks that have run longer than a set time.

The task's size and image are these values.

<<< @/examples/62-ci-runners/src/config.ts{runner}

The size matches GitHub's standard Linux runner (2 cores and 8 GB for a private repository). The image is the runner image GitHub publishes for Actions Runner Controller. On 2026-10-13 its manifest was read from ghcr.io: the tag `2.338.0` includes linux/arm64, and the digest is the one above. Besides the runner itself, the image's Dockerfile installs little more than git, curl, jq, unzip, sudo, and the Docker CLI. There is no AWS CLI. Whatever tools a job needs are installed in the workflow or added in an image of your own. The runner's user has passwordless sudo, so inside the task a job can do what root can. The protection is exactly as wide as what cannot be reached from the task.

The network is chapter 11's VPC, imported. Tasks go into the public subnets with a public IPv4 address, which avoids a NAT gateway's monthly fee. To let jobs reach something inside the VPC, allow the task's security group in that resource's security group. For tasks in private subnets, chapters 11 and 41 cover the choice of a way out.

[Design and Build](/en/chapters/62-ci-runners/build.md) reads the code in order: registration, receiving, deciding, launching, and the stack.
