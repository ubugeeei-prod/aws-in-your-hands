---
title: "34 Kubernetes: Run It Locally"
---

# 34 Kubernetes: Run It Locally

## Checking on a laptop

<!-- section: 34.local -->

This chapter runs no cluster on the laptop. The Nix shell has no Docker daemon, and no kind or minikube. The app itself runs with chapter 12's `vp run dev:ecs`: the image and the server are the same.

What can be checked locally is everything before the cluster gets it.

```bash
vp run test:unit
vp run eks:render
vp run eks:infra:synth
vp run eks:infra:synth -c deployRoleArn=arn:aws:iam::123456789012:role/aih-deploy
```

The tests look at five things.

| Subject | File | What it checks | What it does not |
| --- | --- | --- | --- |
| Manifests | `test/manifests.test.ts` | That they fit this chapter's schemas, the references between objects, the files in `k8s/` against the generators | That the API server accepts them, that Auto Mode acts on them as written |
| How many may be missing | `test/rollout.test.ts` | The arithmetic of rollouts, PodDisruptionBudgets, and drains | What the real scheduler and controllers do, node failures |
| Durations | `test/timing.test.ts` | How the durations relate, including chapter 12's rules | That no request is in fact dropped with those values |
| Support windows and cost | `test/support.test.ts`, `test/pricing.test.ts` | The date arithmetic, the amounts in the text against the pricing data | The bill itself |
| Infrastructure | `infra/test/eks-stack.test.ts` | The roles' trust policies and policies, the scope of the access entries, the Auto Mode settings, the resource types | That cdkd and Cloud Control API can create what the template says |

The manifests can also be printed without deploying the stack. With every value given as a flag, nothing is read from AWS.

```bash
vp run eks:manifests cluster --node-role AihEks-NodeRole-EXAMPLE --security-group sg-0123456789abcdef0
vp run eks:manifests app --image 123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/repository-name:v1
```

The following cannot be reproduced locally.

- Creating the cluster, and nodes joining it
- How scheduling, probes, rollouts, and drains actually behave
- Auto Mode creating an ALB from the Ingress, and the annotations taking effect
- Pod Identity credentials reaching a pod
- cdkd creating `AWS::EKS` resources through Cloud Control API

`k8s/app.json` could be tried on a local cluster tool such as kind, but the NodeClass, NodePool, and IngressClassParams in `k8s/cluster.json` are kinds specific to EKS and cannot be applied there. This book did not try it.
