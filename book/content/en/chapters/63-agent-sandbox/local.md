---
title: "63 Agent Sandbox: Run It Locally"
---

# 63 Agent Sandbox: Run It Locally

## Checking it locally

<!-- section: 63.local -->

What runs locally in this chapter is everything around the agent, and not the agent. No agent is started, and nothing calls the model, GitHub, or AWS. It needs no credentials and costs nothing.

The tests run with this command.

```bash
vp test run examples/63-agent-sandbox
```

What they check, in the order of what they protect:

- **The invariant.** The synthesized stack's task role reaches none of: a production table, bucket, or secret, the deploy role, another task definition, its own log group. Only ECS tasks can assume the role, and only the launcher can pass it
- **The launcher's decision.** It refuses a repository that is not on the list, time and budget over the limits, too many tasks at once, and a spent daily budget. For a refused request it speaks to neither GitHub nor ECS. The same request delivered twice, or twice at nearly the same moment, starts one task. A token wider than the one asked for starts none
- **The task's steps.** The token goes to the clone and the push only, and is in neither the agent's process nor any command's arguments. The push goes to a written-out URL and the work branch. Nothing is pushed when the agent fails, runs into the deadline, or changes nothing
- **The allowlist.** Names that merely contain an allowed one, other ports, IP addresses, and URLs with credentials are refused. The destinations in Claude Code's settings are destinations the evaluator allows
- **The reaper.** It stops a task exactly at its deadline, goes on to the rest when one will not stop, and does not call CloudWatch when there is no task

The tests of the task's steps replace the function that runs commands with a fake. Neither Git nor Claude Code actually runs. What is checked is which commands are called, in which order, with which environment. Whether those commands then behave as expected is not.

How the launcher decides one request can be seen with this task.

```bash
vp run sandbox:plan
vp run sandbox:plan --repository acme/web
vp run sandbox:plan --running 2
```

The first prints, in order, the values that would go to RunTask, the `claude` command that would run inside the task, the settings file, and the Network Firewall rule. The second and third print a reason for refusing. The clock is fixed, so every run prints the same thing.

What each role of the stack can do is shown by this task.

```bash
vp run sandbox:policy
vp run sandbox:policy --exec
```

The second shows what the task role gains when ECS Exec is on.

What synth produces depends on whether there is a tag.

```bash
vp run sandbox:infra:synth
vp run sandbox:infra:synth -c imageTag=a1 -c repositories=acme/notes
```

The two files that go into the image are made by this task.

```bash
vp run sandbox:bundle
```

What is not reproduced locally is everything that involves the agent: building the image (the Nix shell has no Docker daemon), whether Claude Code's sandbox starts inside Fargate, authentication to Bedrock, the exchange with GitHub, and the reaper stopping a real task. Each can be checked only by going through the steps under [Deploy](/en/chapters/63-agent-sandbox/deploy.md).
