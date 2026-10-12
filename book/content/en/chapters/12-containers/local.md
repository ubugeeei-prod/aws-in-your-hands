---
title: "12 Containers: Run It Locally"
---

# 12 Containers: Run It Locally

## Checking things locally

<!-- section: 12.local -->

Here is everything so far that needs neither Docker nor AWS.

```bash
vp run test:unit
vp run ecs:bundle:check
vp run ecs:infra:synth
vp run ecs:infra:synth -c imageTag=v1
```

The tests look at four places.

| Where | File | What it checks | What it doesn't |
| --- | --- | --- | --- |
| The process | `test/shutdown.test.ts` | That SIGTERM lets the request in flight finish before the exit | How signals arrive inside a container, the order ECS sends things in |
| Versions together | `test/versions.test.ts` | That old and new read the same records, and the two ways to break that | A real data store, the load balancer's routing |
| Settings and durations | `test/timing.test.ts`, `test/config.test.ts`, `test/compose.test.ts` | How the durations relate, tag validation, the `docker` command lines | That those values really prevent 502s |
| Infrastructure | `infra/test/containers-stack.test.ts` | Permissions, the ways in, the replacement settings, no hourly resources without a tag | That AWS behaves as the template says |

Let's also be clear about what is not reproduced locally.

- Building the image, and starting it as a container
- Whether Fargate can fetch the image (route and permissions)
- The load balancer's routing and health checks
- How rolling updates, the circuit breaker, and auto scaling actually behave
- That cdkd creates the resources as the template says

About cdkd, I read the source of the pinned version (0.296.28). Of the 15 resource types this stack uses, cdkd has its own implementation for 12: the ECS cluster, task definition, and service; the load balancer, listener, and target group; the ECR repository; the security group and its ingress rule; the IAM role and policy; the log group. The other three, `AWS::ApplicationAutoScaling::ScalableTarget`, `AWS::ApplicationAutoScaling::ScalingPolicy`, and `AWS::EC2::SecurityGroupEgress`, go through Cloud Control API. A test pins the list of types, and that the stack uses only properties the dedicated implementations handle.
