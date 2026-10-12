---
title: "62 CI Runners: Build, Continued"
---

# 62 CI Runners: Build, Continued

The [previous page](/en/chapters/62-ci-runners/build.md) assembled, by hand, a design that receives a webhook and starts a Fargate task. This page covers the ready-made ways to do the same, the GitLab case, and Docker builds, which Fargate cannot do. Everything here is what the documentation said on 2026-10-13. None of it was run.

## The ways GitHub lists, and CodeBuild

<!-- section: 62.options -->

GitHub's documentation recommends ephemeral runners for autoscaling and says autoscaling with persistent runners is not recommended. It then lists three ways.

**Actions Runner Controller (ARC).** A Kubernetes operator. A pod called the listener holds an HTTPS long poll to GitHub; when a job arrives, the controller creates a JIT configuration and starts one runner pod. GitHub recommends ARC to teams with Kubernetes infrastructure and experience. If you already have the cluster of [chapter 34](/en/chapters/34-eks.md), it is a strong choice. A cluster kept only for runners is not worth it. The listener always runs, so the cluster and the pod cost money while there are no jobs.

**The runner scale set client.** A Go client for the API that ARC uses (runner scale sets), usable without Kubernetes, published as `actions/scaleset`. Its README says it is in public preview; it handles creating scale sets, generating JIT configurations, and receiving messages, and leaves starting runners to you. Its advantage is that no endpoint has to be open to receive webhooks. In exchange, a process that holds the long poll to GitHub has to run somewhere all the time.

**The `workflow_job` webhook.** This chapter's way. The documentation says you can build your own autoscaling from this webhook's payloads. Nothing runs all the time; in exchange you own one public URL and handle duplicate and missed deliveries yourself.

AWS has a ready-made way too.

**CodeBuild-hosted runners.** You set a webhook on a CodeBuild project that receives `WORKFLOW_JOB_QUEUED` events. The workflow says `runs-on: codebuild-<project-name>-${{ github.run_id }}-${{ github.run_attempt }}`. For each job CodeBuild starts a build, runs an ephemeral runner in it, and ends the build when the job ends. Buildspec commands are ignored by default. The connection to GitHub uses a GitHub App, an OAuth app, or a personal access token.

Of what this chapter wrote, CodeBuild takes over the receiving, the deciding, the registration, the launch, and the cleanup. Not a line of the previous page's code is needed. The differences are these.

| | This chapter's design | CodeBuild-hosted runner |
| --- | --- | --- |
| What you write | The receiving Lambda, the stack | The project's settings |
| A job's environment | A Fargate task | A CodeBuild build environment (EC2 or Lambda) |
| Docker daemon | Not available | Available with the project's `privilegedMode` (on EC2) |
| Refusing jobs from forks | Done by your code | Not found in the documentation. Relies on GitHub's settings |
| What a job can reach | An empty task role | The project's service role |
| Price per minute (Tokyo, arm64) | About USD 0.0020 (2 vCPU, 8 GB) | USD 0.00425 (arm1.small) |

The last two rows are what to weigh. A CodeBuild build runs with the project's service role. Assume that any permission on that role is usable from the job. With CodeBuild too, the role should carry only the minimum, such as writing logs, and AWS should be entered by OIDC. How the service role's credentials appear to a runner's job, though, could not be confirmed from the documentation.

For many teams CodeBuild is still the better fit: no code to maintain, Docker builds work, and not enough volume for the price difference to matter. This chapter's design fits when you want your own code to decide what launches, when a job's environment has to sit in your own task definition and network, or when the volume is large.

CodeBuild's Lambda compute starts faster, but it cannot do Docker builds or run longer than 15 minutes.

## Doing the same for GitLab

<!-- section: 62.gitlab -->

GitLab Runner is built differently. A long-running process called the runner manager keeps asking GitLab whether there is a job (`POST /api/v4/jobs/request`) and has an executor run each job it receives. A way to use a webhook to start a runner per job, the counterpart of GitHub's `workflow_job`, was not found in GitLab's documentation. A webhook for job status changes exists, but nothing connects it to autoscaling runners. With GitLab, then, something is always running.

**Registration.** The runner manager registers with GitLab using a runner authentication token (it starts with `glrt-`). The token is created in the UI or with `POST /user/runners` and stored in the runner manager's `config.toml`. The older registration tokens are deprecated and, the documentation says, scheduled for removal in GitLab 20.0. Unlike GitHub's JIT configuration, this token is not single-use: the runner manager keeps using it for as long as it runs. An expiry with automatic rotation can be configured. The token sits on a long-lived host, so the place to protect is the runner manager's host.

**One environment for one job.** Jobs are run by an executor. The main executors are Kubernetes, Docker, Docker Autoscaler, and Instance; Shell and Docker Machine are in maintenance mode or deprecated. To make a new environment per job on AWS, combine Instance or Docker Autoscaler with a fleeting plugin. The plugin for AWS (`fleeting-plugin-aws`) lets the runner manager raise and lower the size of an EC2 Auto Scaling group directly.

The Instance executor's documentation says that with `capacity_per_instance` and `max_use_count` both set to 1, each job is given an ephemeral instance that other jobs cannot affect, and the instance is deleted as soon as the job completes. That is the setting that corresponds to this chapter's invariant. A `max_use_count` above 1 means an instance is reused for several jobs.

For the Auto Scaling group, the plugin's README lists conditions: desired and minimum capacity zero, no scaling policy, the `AZRebalance` process suspended, and scale-in protection enabled. The point is that the runner manager alone decides the size. The README also lists the IAM actions the runner manager needs.

The documentation's example sets `idle_count = 5`, which keeps five instances waiting. Jobs wait less, but five instances are billed while nothing is running. With 0, an instance starts only when a job comes, and jobs wait longer.

**In terms of this chapter.** One runner manager runs as a small Fargate service or an EC2 instance, and jobs run on the Auto Scaling group's instances. The runner manager is billed in a month without jobs too. On chapter [23](/en/chapters/23-ec2.md)'s t4g.small it is USD 16.54 a month with an 8 GB volume (chapter 41's arithmetic). For running jobs on Fargate, GitLab publishes a procedure for a Fargate driver, and states that it is community supported and not meant for production. It needs an EC2 instance for the runner manager as well.

When jobs run on EC2 instances, a job can fetch the instance profile's credentials from instance metadata. Give the job instances no profile, or a role that allows nothing.

**CodeBuild.** CodeBuild supports GitLab runners in the same form. A job in `.gitlab-ci.yml` with `tags: codebuild-<project-name>-$CI_PROJECT_ID-$CI_PIPELINE_IID-$CI_JOB_NAME` starts one build, in which a runner runs that one job. No long-running runner manager is needed this way. The runner runs inside the build's container with the shell executor.

**Forks and protection.** In GitLab, a pipeline for a merge request from a fork is by default created and run in the fork's project. The documentation warns that running it in the parent project uses the parent's runners, and that the fork's code may try to steal the parent's secrets. A runner can also be limited to jobs on protected branches (a protected runner).

**The way into AWS.** A GitLab job can assume an AWS role by OIDC as well. The job declares `id_tokens`, receives a token, and passes it to `sts assume-role-with-web-identity`. The trust policy narrows on the value of `gitlab.com:sub` (of the form `project_path:<group>/<project>:ref_type:branch:ref:main`). The idea is chapter 20's: the permissions belong to the role the job assumes, not to the runner's role.

## Building images without privilege, and where caches go

<!-- section: 62.docker-builds -->

A Fargate task cannot run privileged containers. The ECS documentation names Docker in Docker as a use this affects. This chapter's runner image contains the Docker CLI and buildx, but no daemon is running. A `docker build` in a job therefore fails. In GitHub Actions, jobs with `container:`, service containers, and Docker container actions also assume Docker is installed on a Linux runner, so they do not work on this chapter's runners.

When images have to be built, these are the options, as far as the documentation goes.

- **Send only the build to a place with a daemon.** The simplest. Give the job that builds the image a `runs-on` for GitHub's runners or a CodeBuild-hosted runner, and keep the other jobs on your own. With `privilegedMode` enabled on the project, CodeBuild can run a Docker daemon inside the build
- **Rootless BuildKit.** For runners that cannot use privileged mode, GitLab's documentation gives a procedure with the `moby/buildkit:rootless` image and `--oci-worker-no-process-sandbox`. BuildKit's own documentation says running rootless inside a container takes either lifting the seccomp and AppArmor restrictions or that flag, and that the flag is discouraged. Neither document says whether it works in a Fargate task, and it was not tried
- **Buildah.** GitLab's documentation lists it as a way to build OCI images without a daemon. Whether it works on Fargate was not tried
- **Not kaniko.** It used to be the standard answer. Google's repository was archived on 2025-06-03 and its README says it is no longer developed or maintained. GitLab's documentation marks its kaniko page "removed"

In the end, the documentation does not let anyone say what is certain to work on Fargate. The first option, moving the build job elsewhere, is the one to take.

Do not solve it by handing a job a privileged container or the Docker socket. GitLab's security page says privileged mode effectively disables all of a container's security mechanisms. Inside a disposable virtual machine, the effect stays within that one machine. That is why a design that uses an EC2 instance for one job and throws it away suits Docker builds.

### Caches

A disposable environment has none of the dependencies an earlier job downloaded. Fetching them again for every job takes time. This is the other face of the invariant: a design that keeps a local cache is a design that shows the next job what an earlier job wrote. A cache goes outside the environment, with a decided scope of trust.

GitHub Actions' cache (`actions/cache`) allows 10 GB per repository by default and removes entries not accessed for 7 days. Where caches written from self-hosted runners are stored, and what they cost, the pages read did not say.

GitLab Runner has a setting for keeping the cache in S3. In `config.toml`, `[runners.cache]` takes `Type = "s3"`, and `[runners.cache.s3]` takes the bucket, the Region, and the authentication type (`iam` or `access-key`). The documentation explains that with autoscaling most jobs run on a new host, where a local cache is of no use, and that the distributed cache exists for that reason.

Either way, a cache is something one job writes and a later job reads. Do not let a job for production read a cache that a job on an untrusted branch wrote. GitHub's documentation lists, among the risks, that privileged workflows such as `pull_request_target` share a cache with the main branch.

Container image layers can go to ECR, as in [chapter 52](/en/chapters/52-ecr.md). Building a runner image of your own with the tools already in it also reduces what is fetched again. Fargate pulls the whole image for every task, though, so a larger image means a slower start (chapter 41).

Next is [Deploy](/en/chapters/62-ci-runners/deploy.md).
