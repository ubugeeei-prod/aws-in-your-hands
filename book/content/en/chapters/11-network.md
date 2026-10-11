---
title: "11 The Network You Actually Need: VPC, Subnets, NAT, and Endpoints"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 11 The Network You Actually Need: VPC, Subnets, NAT, and Endpoints

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/11-network` does not exist yet.

## Outcome

You build the smallest VPC the database and container chapters need and can name every hourly-billed part.

## Prerequisites

- [02 Reproducible TypeScript Development: Nix, vp, CDK, cdkd, and Drift](/en/chapters/02-toolchain.md)

Reading paths: `containers`

## Planned architecture

Public and private subnets in two AZs. No NAT until it is needed; compare its cost with endpoints.

Services: VPC, NAT Gateway, VPC endpoints

## Topics

- Route tables decide reachability
- Security groups are stateful
- Fixed costs of NAT Gateways, public IPv4, and interface endpoints
- When Lambda belongs in a VPC

## The distributed-systems angle

Multiple AZs do not protect against a regional outage; keep AZs and regions distinct.

## Source required for completion

- VPC CDK with an assertion that no NAT exists
- Pricing inputs that compute the monthly cost per layout

## Primary sources to start from

- [Amazon VPC pricing](https://aws.amazon.com/vpc/pricing/) (not re-read while writing)
