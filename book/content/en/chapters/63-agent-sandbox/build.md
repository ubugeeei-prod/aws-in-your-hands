---
title: "63 Agent Sandbox: Design and Build"
---

# 63 Agent Sandbox: Design and Build

The [overview](/en/chapters/63-agent-sandbox.md) showed the design: one task per job. This page follows a request until it is a task: the launcher's decision, how the repository gets in and out, and how Claude Code is started inside the task. The permissions and the egress the agent is given, the limits, and the records are on the [next page](/en/chapters/63-agent-sandbox/more.md).

```figure
caption: One request. A credential is made only after every reason to refuse is gone
type: sequence
actor launcher: Launcher
actor github: GitHub
actor task: Task
actor model: Bedrock
step launcher -> launcher: checks and limits
step launcher -> github: issue a token
step launcher -> task: RunTask
step task -> github: clone
step task -> model: claude -p
step task -> github: push, pull request
note task: exits; the volumes are gone
```

## The launcher's decision

<!-- section: 63.launch -->

The shape of a request is a Valibot schema. A key it does not know is refused, not dropped.

<<< @/examples/63-agent-sandbox/src/job.ts{request}

`requestId` names the request: the same ID delivered twice starts one task. `task` is the text handed to the agent, 2000 characters at the most. It travels in RunTask's overrides, and the API reference allows 8192 characters of overrides in all, JSON punctuation included.

Whether to start a task is decided by a pure function. It calls neither AWS nor a clock.

<<< @/examples/63-agent-sandbox/src/job.ts{decide}

There are five reasons to refuse, and each only compares a value from outside with the stack's settings. The list of allowed repositories comes from the stack's context (`-c repositories=owner/name`). It is empty by default, so a stack that was given nothing refuses every request. Repository names are compared without regard to case, because that is how GitHub treats them.

The work branch is `agent/<requestId>`. A request can choose the base branch only; it has no say in the work branch's name.

A request that passes becomes a launch plan. The plan's `startedBy` goes into RunTask's parameter of that name.

<<< @/examples/63-agent-sandbox/src/job.ts{started-by}

The deadline is in `startedBy` for the reaper's sake: it reads this value off the list of tasks and stops the ones whose deadline has passed. A tag could carry the deadline too, but tagging a task as it is started takes the `ecs:TagResource` permission, and `startedBy` takes none. It allows letters, digits, hyphens, slashes and underscores, up to 128 characters.

The launcher itself takes every question it asks of the outside world as an argument.

<<< @/examples/63-agent-sandbox/src/launcher.ts{launch}

The order matters. GitHub is asked for a token only after every reason to refuse is gone, so that a refused request never causes one more credential to exist. The tests check, for every refusal, that the launcher spoke to neither GitHub nor ECS.

A request that arrives twice is handled in two steps. If a running task already carries the same `requestId`, the launcher answers with that task. If two deliveries arrive so close together that neither sees a task, RunTask's `clientToken` catches it: ECS answers a known token with a different request body with `ConflictException`, and names the tasks it already started. The second delivery carries a different Git token, so its body always differs. The launcher returns that exception as "already launched".

The token GitHub returns is not taken on trust either.

<<< @/examples/63-agent-sandbox/src/github.ts{token}

What was asked for is one repository and two permissions (write on `contents` and on `pull_requests`). If the token that comes back is wider, no task is started; the same if it would expire before the task's deadline. By GitHub's documentation, a token made without `repositories` reaches every repository the app is installed on. Leaving that parameter out is an easy mistake, so the answer is checked as well.

## Getting the repository in and out

<!-- section: 63.repository -->

The credential for the repository is a GitHub App installation access token. By the documentation it expires an hour after it is made, and can be narrowed to repositories and permissions when it is issued. Unlike a personal access token or an SSH key, one that is left lying around is useless an hour later.

Making a token takes a JWT signed with the app's private key. The private key is a long-lived credential, so it sits in Secrets Manager and only the launcher reads it. A task never sees the key.

<<< @/examples/63-agent-sandbox/src/github.ts{jwt}

The JWT is what GitHub's page describes: signed with RS256, issued 60 seconds in the past against clock drift, expiring within ten minutes. The test signs with a key made on the spot and verifies with its public half. No real GitHub App is involved.

The secret has a fixed shape. The stack does not create this secret; it refers to it by name.

<<< @/examples/63-agent-sandbox/src/github.ts{app-secret}

The token reaches the task as an environment override in RunTask. That has a weakness. The ECS API reference points to Secrets Manager or Parameter Store for sensitive values, and the shape of RunTask's response shows the overridden environment sitting in the task's description as it was given. Whoever can read task descriptions in the sandbox account can read the token. This chapter uses overrides anyway, because an override has no field that refers to a secret, and a secret made and deleted per job would add parts. What is exposed is a token for one repository that lasts an hour. Whether CloudTrail's RunTask event keeps the value was not checked.

What the task does is in one function. Running commands and reaching the network are handed in, so the tests hand in fakes.

<<< @/examples/63-agent-sandbox/src/run.ts{run}

This is how Git is given the credential.

<<< @/examples/63-agent-sandbox/src/run.ts{git}

GitHub's documentation shows how to use an installation token as the HTTP password, with the user name `x-access-token`. Its example writes the token into the URL; this chapter hands it over through a Git credential helper, because a URL stays in the process list and in `.git/config`. The helper reads the token from an environment variable, and only two commands are given that variable: the clone and the push.

Hooks are off (`core.hooksPath=/dev/null`). While it works, the agent can write files into `.git/hooks`. If one of them ran during the push, code the agent wrote would run inside a process that holds the token. The push address and branch are written out in the command too, not read from the repository's configuration.

One thing has to be said plainly here. None of this hides the token from the agent. The agent's commands run as the same user, in the same container, as the program that walks through these steps, and a process can read the environment of another process of the same user if it sets out to. The design is made to hold with the token readable by the agent: it reaches one repository, it dies within the hour, and where it can be sent is narrowed by the allowlist. The design that really keeps the token away is the proxy pattern that Claude Code's documentation recommends: a proxy outside the agent's boundary adds the credential to requests.

The result leaves as a work branch and a pull request.

<<< @/examples/63-agent-sandbox/src/github.ts{pull-request}

**It is not this code that stops a push to the default branch.** A token with write on `contents` can push to any branch that is not protected, and an agent that reads the token can push straight to the base branch. What stops it is a rule on GitHub's side. In the repository's ruleset, require a pull request before merging on the default branch, set the number of required approvals to one or more, and block force pushes. By the rulesets page, requiring a pull request alone does not require an approval, so set the number as well. That an approval given with the agent's token does not count was not confirmed.

When the agent ends in an error or runs into the deadline, nothing is pushed. There is some value in showing a person half-done work, but not presenting a failed run in the same form as a successful one came first.

## Starting Claude Code

<!-- section: 63.agent -->

The command that runs Claude Code inside the task is assembled by this function. Every flag in it is in the CLI reference.

<<< @/examples/63-agent-sandbox/src/agent.ts{command}

**`-p`** runs once, without a terminal interface, and exits with status 0 on success.

**`--bare`** is the flag that matters most in this chapter. By the documentation, a `-p` run without `--bare` runs the hooks in the project's `.claude/settings.json` and connects to the servers in its `.mcp.json`, and no dialog asks whether the folder is trusted. In other words, the contents of a cloned repository act as the agent's configuration. `--bare` stops the automatic loading of hooks, skills, plugins, MCP servers, and `CLAUDE.md`. The cost is that instructions in the repository's `CLAUDE.md` are not read either; whatever the agent needs to be told goes in the request's text.

**`--permission-mode dontAsk`** denies, without asking, wherever a prompt would have appeared. It is for environments where nobody is there to answer. `bypassPermissions`, which skips every permission check, is not used: the documentation says to use it only in isolated environments without internet access, and this task can reach the internet as far as the allowlist goes.

**`--tools`** narrows which tools exist at all: the shell, and reading, writing, and editing files. Web fetch and web search are left out because, as shown below, they run outside Claude Code's sandbox.

**`--max-turns`** and **`--max-budget-usd`** are limits the agent counts for itself. By the documentation, the amount behind `--max-budget-usd` is an estimate computed locally from a price table bundled at build time; it can differ from the bill, and spend can pass the cap a little. These are inner limits. The outer ones are on the [next page](/en/chapters/63-agent-sandbox/more.md).

**`--output-format stream-json`** writes each event as one JSON object per line on standard output. Tool calls and their results go into the task's log as they are.

The settings file is what this function returns.

<<< @/examples/63-agent-sandbox/src/agent.ts{settings}

Claude Code's sandbox wraps shell commands with an operating system mechanism. On Linux it uses bubblewrap and socat, and a command's network goes through a proxy that checks the host name against an allowlist. Here that allowlist is made from the same single list the network side uses.

Three of the settings close a default. Without `failIfUnavailable`, Claude Code runs commands with no sandbox when the sandbox cannot start. Unless `allowUnsandboxedCommands` is `false`, a command that failed inside the sandbox can be retried outside it. Without `strictAllowlist`, a host that is not on the list is something to ask permission for, not something refused.

`enableWeakerNestedSandbox` goes the other way: it weakens. By the documentation, bubblewrap cannot mount a fresh `/proc` inside an unprivileged container, and this setting shows the container's own `/proc` instead. It reduces security, and is to be used only when the outer container is the boundary. Here the outer boundary is the Fargate task. **Whether this sandbox can actually start inside Fargate was not checked.** If it cannot, `failIfUnavailable` keeps Claude Code from starting and the task ends as a failure. It does not quietly run without a sandbox.

The documentation states this sandbox's limits too. It wraps shell commands only; the built-in tools that read and write files run outside it. The proxy does not look inside TLS and decides by the host name the client gives, so a technique such as domain fronting can reach a host that is not on the list. And what keeps this wall is a process in the same container as the agent. That is why this chapter calls it the inner wall.

The settings file goes into the image at `/etc/claude-code/managed-settings.json`, where Claude Code on Linux reads an administrator's settings. The task's root file system is read-only, so the agent cannot rewrite its own rules. Whether a run with `--bare` reads that location could not be confirmed from the documentation, so the same file is also passed with `--settings`.

The environment given to the agent's process is built from a list of names to keep.

<<< @/examples/63-agent-sandbox/src/agent.ts{environment}

It is a list of names to keep, not of names to remove, so that a variable added later does not pass through silently. The Git token is not on the list, so it does not pass.

The model is called through Bedrock. By the documentation, Claude Code with `CLAUDE_CODE_USE_BEDROCK=1` uses the AWS SDK's default credential chain, which includes an ECS task's credentials. No API key has to sit in the task: the task role is the permission to call the model.

`ANTHROPIC_MODEL` pins the model to one. Without a pin, Claude Code uses its default model for Bedrock, which by the documentation is of the Opus line: a higher price, and a model the task role does not allow. The default here is the Japan inference profile for Claude Haiku 4.5 that [chapter 17](/en/chapters/17-ai.md) confirmed. [Chapter 36](/en/chapters/36-bedrock.md) records that this model may reach end of life on Bedrock as early as 2026-10-16, so read the model card before running anything. To use another model, add its profile to chapter 17's verified list and pass `-c model=...`.

The image is made of these two files and Claude Code itself.

<<< @/examples/63-agent-sandbox/scripts/bundle.ts{bundle}

The `Dockerfile` takes a Node.js image, adds Git and what the sandbox uses (bubblewrap, socat, ripgrep), and installs Claude Code from npm at a pinned version: 2.1.287, which npm's `stable` tag pointed to on 2026-10-13. The Nix shell has no Docker daemon, so this image was never built.
