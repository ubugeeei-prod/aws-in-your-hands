---
title: "12 Run Containers: ECR, ECS/Fargate, and ALB"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 12 Run Containers: ECR, ECS/Fargate, and ALB

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/12-containers` does not exist yet.

## Outcome

The notes API runs as a container on ECS/Fargate and updates without downtime.

## Prerequisites

- [11 The Network You Actually Need: VPC, Subnets, NAT, and Endpoints](/en/chapters/11-network.md)

Reading paths: `containers`

## Planned architecture

ALB → ECS service (private subnets, two tasks). Images live in ECR.

Services: ECR, ECS, Fargate, ALB

## Topics

- The Docker client versus the host daemon
- Health checks, rolling updates, and the circuit breaker
- Task role versus execution role
- Always-on costs (Fargate, ALB, public IPv4)
- Scaling metrics

## The distributed-systems angle

Old and new versions run together during a deployment; both must read the same data format.

## Source required for completion

- Dockerfile and app
- ECS/ALB CDK with assertions
- A graceful-shutdown test that finishes in-flight requests on SIGTERM

## Primary sources to start from

- [What is Amazon ECS?](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html) (not re-read while writing)
- [Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/) (not re-read while writing)
- [Docker overview](https://docs.docker.com/get-started/docker-overview/) (not re-read while writing)
