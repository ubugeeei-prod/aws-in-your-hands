---
title: "34 Kubernetes: Deploy"
---

# 34 Kubernetes: Deploy

## Deploying

<!-- section: 34.deploy -->

Hourly charges begin at the second block of commands on this page. **None of the commands on this page was run against real AWS.** The steps were put together from the documentation and from the source of the pinned tools.

These steps need `kubectl`. This book's devShell (Nix) includes it, at version 1.37.1. Use a `kubectl` within one minor version of the cluster. This cluster is 1.37, so 1.36 to 1.38 will do. The devShell's `kubectl` changes when the nixpkgs pin is updated, so check again with `kubectl version --client` after an update.

First, prepare chapter 11's VPC, and chapter 12's repository and image. Deployed without a tag, chapter 12's stack is the repository alone and has no hourly charge. Building and pushing the image needs a Docker daemon.

```bash
vp run net:infra:deploy
vp run ecs:infra:deploy
vp run ecs:bundle
vp run ecs:image:build v1
vp run ecs:image:push v1
```

Deploy the cluster. **From here on it costs USD 0.10 an hour.**

```bash
vp run eks:infra:diff
vp run eks:infra:deploy
```

cdkd asks Cloud Control API to create the cluster and waits up to 30 minutes for it. At this point there is no node and no load balancer.

Point `kubectl` at the cluster and check that it gets through.

```bash
aws eks update-kubeconfig --name aih-eks --region ap-northeast-1
kubectl get namespaces
```

`update-kubeconfig` writes the cluster's endpoint into your local kubeconfig, with a setting to authenticate through `aws eks get-token`. No password or key is stored. Each time `kubectl` runs, a short-lived token is made from the AWS credentials in use. Run it with the same credentials that deployed the cluster: any other principal has no access entry and is refused.

Apply the manifests that act on the whole cluster.

```bash
vp run eks:manifests cluster | kubectl apply -f -
```

`eks:manifests` reads the node role's name and the cluster security group's ID from the stack outputs, puts them into the manifests, and writes them to standard output. The node pool now exists, but no pod is waiting for a place, so no node starts yet.

Apply the app. **From here on the nodes and the load balancer are billed by the hour.**

```bash
vp run eks:manifests app --tag v1 | kubectl apply -f -
kubectl -n notes rollout status deployment/notes-api
kubectl get nodes -o wide
kubectl -n notes get pods -o wide
```

The pods are Pending at first. Auto Mode sees that and starts nodes, the nodes pull the image, and the pods start running. `kubectl get nodes` should show two `t4g.medium` nodes in different zones.

The ALB's host name appears in the Ingress's status. The documentation says it can take a few minutes to become available.

```bash
kubectl -n notes get ingress notes-api -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
curl -si http://xxxx.ap-northeast-1.elb.amazonaws.com/health
```

If `x-app-version: v1` comes back, the request reached the server inside a pod.

Next, replace it with v2 without stopping. Chapter 12's `ecs:watch` works against this ALB too when given the URL. Leave it running in another terminal and run the following.

```bash
vp run ecs:image:build v2
vp run ecs:image:push v2
vp run eks:manifests app --tag v2 | kubectl apply -f -
kubectl -n notes rollout status deployment/notes-api
```

If it goes wrong, you can go back to the previous version. Unlike the ECS circuit breaker, a Deployment does not roll back by itself. If the new pods never become ready, the rollout stops with the old pods still in place, and after 600 seconds by default it is merely reported as failed. Going back is up to a person or a pipeline.

```bash
kubectl -n notes rollout undo deployment/notes-api
```

`rollout undo` returns the Deployment inside the cluster to its previous version, but the manifest you hold still says v2. Apply it again and v2 is back. After undoing, apply with `--tag v1` so that what you hold and what the cluster holds agree.

To let the deploy role apply the app, give the stack the role's ARN.

```bash
vp run eks:infra:deploy -c deployRoleArn=arn:aws:iam::123456789012:role/aih-deploy
```

As in chapters 11 and 12, `-c` applies to that one command only. Deploy without it and the access entry is deleted, and the deploy role can no longer get into the cluster.

Drift detection is as in chapter 02.

```bash
vp run eks:infra:drift
```

Drift detection sees only what the stack created. The nodes, the ALB, the target group, and the Kubernetes objects are not in cdkd's state and are not checked. Edit the Deployment with `kubectl edit` and cdkd will not notice. Drift inside the cluster is seen with `vp run eks:manifests app --tag v1 | kubectl diff -f -`.

## Upgrading the version

<!-- section: 34.upgrade -->

An EKS cluster has an end date that ECS does not. A Kubernetes minor version comes out about every four months. EKS keeps each one in standard support for 14 months from release, and in extended support for the 12 months after that.

In the release calendar as read on 2026-10-13, standard support covered four versions, 1.34 to 1.37, and extended support three, 1.31 to 1.33. This chapter's 1.37 leaves standard support on December 1, 2027. Dates can change, so read the [calendar](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html) again before you act.

<<< @/examples/34-eks/src/support.ts{calendar}

What happens to a cluster past standard support is decided by `upgradePolicy`.

<<< @/examples/34-eks/src/support.ts{status}

<<< @/examples/34-eks/test/support.test.ts{status}

`EXTENDED` is the default for a cluster created through CloudFormation: the cluster enters extended support and stays on its version. The price becomes USD 0.60 an hour, USD 365.00 a month more. When the 12 months are over, EKS upgrades the cluster by itself.

With `STANDARD`, EKS upgrades the cluster to the next version at the end of standard support, and no surcharge is paid. This chapter's stack uses it. A cluster that has once entered extended support cannot be changed to `STANDARD`.

Either way, **the cluster will be upgraded sooner or later.** The only choice is between upgrading on a day you pick and being upgraded on the day the support ends. Once every 14 months, or every 26 at the longest, the work of an upgrade comes round. It is the most certain recurring job that choosing Kubernetes brings.

These are the rules for an upgrade.

- One minor version at a time. From 1.34 to 1.37 takes three upgrades

<<< @/examples/34-eks/src/support.ts{plan}

- The control plane first, the nodes after. In Auto Mode, once the control plane is upgraded the nodes are replaced one after another by nodes of the new version, and PodDisruptionBudgets are respected while they are. The arithmetic of the previous page is for this replacement
- Within 7 days of an upgrade you can go back to the previous version. After 7 days you cannot
- Before upgrading, check that no API you use is gone in the next version. EKS has a check for this called upgrade insights

In this chapter's stack you raise `KUBERNETES_VERSION` in `src/config.ts` by one and deploy.

<<< @/examples/34-eks/src/config.ts{names}

```bash
vp run eks:infra:diff
vp run eks:infra:deploy
```

Whether cdkd, through Cloud Control API, treats a change of `Version` as an update of the cluster was not checked. Make sure that `diff` shows the cluster as updated, not replaced. If it shows a replacement, do not run it: use `aws eks update-cluster-version`, and bring the stack into line afterwards.

Because Auto Mode takes care of them, there is no upgrading of the VPC CNI, CoreDNS, kube-proxy, or the load balancer controller to do yourself. Had you chosen managed node groups, those and the nodes' AMI would be part of every upgrade.
