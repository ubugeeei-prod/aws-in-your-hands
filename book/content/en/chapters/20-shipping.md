---
title: "20 Ship Changes: CI/CD, OIDC, Environments, Previews, Rollback, and Drift"
generated: true
---

<!-- Generated file. Do not edit. Source: data/chapters.json (tools/src/book/generate.ts) -->

# 20 Ship Changes: CI/CD, OIDC, Environments, Previews, Rollback, and Drift

> [!NOTE]
> This chapter is **planned (not written)**. What follows is the outline it will be written from, not prose and not a working example. `examples/20-shipping` does not exist yet.

## Outcome

CI runs the same vp tasks with short-lived OIDC credentials, and scheduled drift detection reports uninspected scope too.

## Prerequisites

- [02 Reproducible TypeScript Development: Nix, vp, CDK, cdkd, and Drift](/en/chapters/02-toolchain.md)
- [04 Add an HTTP API: Lambda and API Gateway HTTP API](/en/chapters/04-http-api.md)


## Planned architecture

Pull request → check:all → infra:diff. main → deploy (the standard CDK/CloudFormation path). Schedule → drift.

Services: IAM OIDC, CloudFormation, AWS CDK

## Topics

- Taking the chapter 02 drift gate to a live account
- CloudFormation drift-detection coverage and nested stacks
- Never alternating cdkd and CloudFormation over the same resources
- What rolls back and what does not (data, schema)
- Preview-environment cost and cleanup

## The distributed-systems angle

A deployment is not atomic; procedures assume a partially updated state after a mid-flight failure.

## Source required for completion

- OIDC role CDK with trust-policy assertions
- CI configuration (same Nix lock and vp tasks)
- CloudFormation drift polling, parser, and report with fixtures
- A live lab procedure for injecting and resolving drift

## Primary sources to start from

- [Detect unmanaged configuration changes to stacks and resources with drift detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html) (not re-read while writing)
- [Detect drift on an entire CloudFormation stack](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/detect-drift-stack.html) (not re-read while writing)
- [cdkd: Drift](https://cdkd.dev/drift/index.html) (not re-read while writing)
- [cdkd: drift CLI reference](https://cdkd.dev/cli-drift/index.html) (not re-read while writing)
- [cdk diff](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-diff.html) (not re-read while writing)
