---
title: "34 Kubernetes: Build, Continued"
---

# 34 Kubernetes: Build, Continued

The [previous page](/en/chapters/34-eks/build.md) settled what is created on the AWS side. This page writes the manifests that are applied to the cluster: the app itself, the way in, what happens when a pod is stopped, how many pods may be missing at once, and what is kept outside the cluster.

## Manifests written in typed code

<!-- section: 34.manifests -->

Kubernetes manifests are usually written in YAML. This chapter builds them with TypeScript functions and prints JSON. `kubectl apply` reads JSON too, so no dependency for writing YAML is needed. The output is kept in `examples/34-eks/k8s/`, where it can be read without running any code.

The reason for code is how the values connect. The pod's size comes from the same value as chapter 12's task, the durations from the same values as chapter 12's server, and the names of the namespace and the service account from the same constants as the stack. Copied into YAML, nothing would stop someone from fixing one side only.

This is the Deployment.

<<< @/examples/34-eks/src/manifests.ts{deployment}

Set beside chapter 12's task definition, much of it is the same thing under another name.

- `resources.requests` corresponds to `cpu` and `memoryLimitMiB` in the task definition, with a slightly different meaning. A request is a reservation that Kubernetes uses to decide which node the pod goes on. The ceiling on what a pod can actually use is `limits`, set here for memory only: a CPU limit throttles the pod even while the node has room
- `readOnlyRootFilesystem` in `securityContext` is the task definition's `readonlyRootFilesystem`. `runAsUser: 1000` corresponds to `USER node` in the Dockerfile. `runAsNonRoot` cannot check a user given by name, so the number the Node.js image assigns to `node` is written out
- `readinessProbe` and `livenessProbe` are checks in which the kubelet calls `/health` from inside the node. A pod that fails readiness is taken out of the Service's destinations. A pod that keeps failing liveness is restarted. Chapter 12 had only the check the ALB makes from outside; this chapter has both
- `topologySpreadConstraints` places the pods evenly over zones. Without it, both pods may end up on one node
- `nodeSelector` places the pod on arm64 nodes only. It corresponds to `runtimePlatform` in the task definition

`serviceAccountName` is the name that the Pod Identity association of the previous page points at.

### Checking with schemas

The manifests that are built go through Valibot schemas. The schemas hold only the objects this chapter writes, and only the fields it uses.

<<< @/examples/34-eks/src/k8s/schema.ts{workload}

Every object is a `v.strictObject`, so a field that is not in the schema is refused. A slip such as `readinesProbe` for `readinessProbe` fails a test on the laptop.

<<< @/examples/34-eks/test/manifests.test.ts{refused}

**These schemas are not the API server's validation.** The Kubernetes API has dozens of times as many fields as are written here, and many constraints between them. Nothing guarantees that the API server accepts a manifest the schemas passed, and most of the fields the schemas refuse are valid Kubernetes. All they establish is that this chapter's generators and the files in `k8s/` have not left the shape this chapter decided on. NodeClass and IngressClassParams are kinds specific to EKS, and their schemas were written from the examples in the documentation.

### How the objects find each other

Kubernetes objects find each other by names and labels. A Service sends to the pods whose labels match its selector. A PodDisruptionBudget protects the pods its selector matches. When one of these links is broken, Kubernetes reports no error. The Service exists with no destinations, and the PodDisruptionBudget exists and protects nothing.

A schema that looks at one object cannot find such a mistake, so there is a separate check.

<<< @/examples/34-eks/src/k8s/check.ts{references}

<<< @/examples/34-eks/test/manifests.test.ts{silent}

The tests break the links one at a time and check that each is reported. The last test reports that, looking at the app's manifests alone, the namespace is missing: the order, `k8s/cluster.json` first, is something this check tells you.

The files in `k8s/` are not edited by hand.

```bash
vp run eks:render
vp run eks:render --write
```

The first fails when a file differs from what the generators produce. The second rewrites them. The role name, the security group ID, and the image URI in the files are example values. The real ones are filled in from the stack outputs at deploy time.

<<< @/examples/34-eks/src/rendered.ts{example}

## The way in

<!-- section: 34.traffic -->

In chapter 12 the ALB, the listener, and the target group were written in the stack. Here, writing the following two objects in a manifest makes Auto Mode create the same things.

<<< @/examples/34-eks/src/manifests.ts{traffic}

The **Service** gives the set of pods with matching labels the name `notes-api` and port 80. The **Ingress** says that HTTP from outside goes to that Service. Auto Mode sees it, creates an ALB, and registers the pods' IP addresses directly in the target group. That is the same shape as chapter 12's target group with `target type: ip`.

Which controller handles an Ingress is decided by its IngressClass.

<<< @/examples/34-eks/src/manifests.ts{cluster}

The `controller` is `eks.amazonaws.com/alb`, so what handles it is the feature built into Auto Mode. In a cluster without Auto Mode you install AWS Load Balancer Controller into the cluster yourself, give it IAM permissions, and keep upgrading it.

The subnets for the ALB are chosen in `IngressClassParams`. By default Auto Mode looks for public subnets by the tag `kubernetes.io/role/elb`, which chapter 11's subnets do not carry. Rather than rewrite chapter 11's stack, they are named here by their `Name` tag.

The annotations on the Ingress set the same health check and deregistration delay as chapter 12's target group. The values come from the same file as in chapter 12. The annotation names are those of AWS Load Balancer Controller; the Auto Mode documentation says that annotations on an Ingress can configure the load balancer, and lists the ones that are not supported. The seven used here are not on that list. That they take effect under Auto Mode was not checked.

The listener is HTTP on port 80 only, as in chapter 12, and the traffic is not encrypted. For HTTPS, write the certificate's ARN in `certificateARNs` of `IngressClassParams`.

The Gateway API is another route, in place of an Ingress. The documentation says AWS Load Balancer Controller creates an ALB for a Gateway from version 2.14.0. Whether the feature built into Auto Mode handles the Gateway API could not be found in the documentation that was read, so this chapter uses an Ingress.

## When a pod is stopped

<!-- section: 34.shutdown -->

Chapter 12's server, on SIGTERM, stops accepting new requests, answers the ones in flight, and gives up after 25 seconds. The image is the same, so the server behaves the same. What changes is the order of events before SIGTERM arrives.

ECS took the task out of the load balancer first and sent SIGTERM after the deregistration delay. Kubernetes **starts removing the pod from the destinations and sending SIGTERM at the same time**. The server may stop accepting connections before the load balancer has finished removing it, and a request that arrives in between fails.

```figure
caption: Kubernetes starts removing the pod from the destinations and stopping it at the same time. The preStop hook waits 15 seconds, so by the time SIGTERM arrives the load balancer no longer sends new requests
type: sequence
actor cp: Kubernetes and the ALB
actor pod: The server in the pod
step cp -> cp: t0: the pod is to be deleted
note cp: removal from the destinations begins
step cp -> pod: t0: preStop, wait 15 seconds
note pod: no SIGTERM yet
note pod: still answers what arrives
note cp: the ALB stops sending new requests
note cp: deregistrationDelay = 30
step cp -> pod: t0+15: SIGTERM
step pod -> pod: logs "draining", stops listening
step pod -> pod: finishes what is in flight, exit 0
step pod -> pod: t0+40: deadline, cuts the rest, exit 1
step cp -> pod: t0+45: SIGKILL if still there
note cp: terminationGracePeriodSeconds = 45
```

The usual remedy is to wait before SIGTERM. With a `sleep` in the Deployment's `preStop`, the kubelet waits that many seconds and then sends SIGTERM. While it waits, the server answers as usual.

The durations are chapter 12's with this chapter's added, in one object.

<<< @/examples/34-eks/src/timing.ts{timing}

`terminationGracePeriod` runs from the start of `preStop` to SIGKILL. The time spent in `preStop` is taken out of it. At the default of 30 seconds, after waiting 15 the server would have 15 left, and SIGKILL would come before the server's own deadline of 25. At 45, 30 seconds remain after SIGTERM, the same as `stopTimeout` in chapter 12.

How the values relate is checked with chapter 12's rules as they are, plus this chapter's.

<<< @/examples/34-eks/src/timing.ts{rules}

<<< @/examples/34-eks/test/timing.test.ts{broken}

The 10 seconds of `deregistrationLag` are an assumption. How long it takes for the controller to notice the pod's deletion and for the ALB to stop sending new requests to that target was not measured for this book. The 15 seconds of `preStop` are that assumption with some margin. If requests fail during a rollout on a real cluster, this is the first value to suspect.

`minReadySeconds` is a precaution of the same kind. When the kubelet's readiness check passes, the ALB may not yet have finished its health check of that pod. Not counting a new pod as available for 30 seconds keeps the old pods from being stopped before the ALB has started using the new ones. AWS Load Balancer Controller has a mechanism that feeds the ALB's verdict into pod readiness (a readiness gate). Whether Auto Mode offers the same was not checked.

## How many pods may be missing at once

<!-- section: 34.disruption -->

Pods go missing for three reasons: a rollout of a new version, the replacement of a node, and a failure. The first two each have a setting of their own.

### During a rollout

The Deployment's `maxSurge` and `maxUnavailable` correspond to `maximumPercent` and `minimumHealthyPercent` in chapter 12. They count differently, so there is a function.

<<< @/examples/34-eks/src/rollout.ts{rolling}

Written as percentages, `maxSurge` rounds up and `maxUnavailable` rounds down. With this chapter's values (`100%` and `0`) there are at most four pods, and never fewer than two available. That is how 200 and 100 behaved in chapter 12.

<<< @/examples/34-eks/test/rollout.test.ts{rolling}

Kubernetes defaults both to 25%. With two pods, 25% is 0.5: one may be added, rounding up, and none removed, rounding down. Even the defaults never go below two. The result changes with the number of pods, though, so writing numbers is harder to misread than relying on the defaults.

`rolloutSteps` is a small model that lists the stages of a rollout. It assumes that all new pods become available together, so it is not what a real cluster does step for step.

### When a node is replaced

An Auto Mode node is replaced after 21 days at most. The default is 336 hours (14 days), and nodes are also replaced each time a new AMI comes out, about once a week. The same happens when the Kubernetes version is upgraded. Emptying a node is called a drain, and the pods on it are asked to leave one by one (eviction).

On Fargate, a task was stopped mostly when you deployed. With Auto Mode the pods are moved at least once every two weeks even when nothing is deployed.

A **PodDisruptionBudget** decides how many such evictions are allowed at once.

<<< @/examples/34-eks/src/manifests.ts{budget}

<<< @/examples/34-eks/src/rollout.ts{budget}

With `maxUnavailable: 1` and two pods, one eviction is allowed while two pods are healthy, and the next is refused once there is one (the API answers 429). Written as a percentage, both `minAvailable` and `maxUnavailable` round up. With `maxUnavailable: 30%` and seven pods, 2.1 becomes 3, and more go missing than the percentage reads.

The following function traces a drain step by step.

<<< @/examples/34-eks/src/rollout.ts{drain}

<<< @/examples/34-eks/test/rollout.test.ts{drain}

The three tests are the three outcomes a PodDisruptionBudget can have.

With this chapter's settings, two pods on the same node leave one after the other, and one is always answering.

Without a PodDisruptionBudget both are evicted at once, and nobody answers until the replacements have started. The Deployment's `maxUnavailable: 0` is a setting for rollouts and has no effect on a drain.

With `minAvailable` equal to the number of pods, no eviction is ever allowed and the drain never ends. A setting meant to protect the pods stops the nodes from being updated. The Auto Mode documentation says that intervention may be required before the 21-day limit. What happens to the pods when the limit is reached was not checked.

### When the two overlap

A drain can begin in the middle of a rollout. According to the documentation, pods that a rollout has taken away count against the PodDisruptionBudget, but the rollout of a Deployment is not itself held back by it.

<<< @/examples/34-eks/src/rollout.ts{floor}

<<< @/examples/34-eks/test/rollout.test.ts{floor}

With this chapter's settings, voluntary disruptions alone never leave fewer than one pod answering. That is this chapter's invariant.

**A node failure is outside this arithmetic.** A PodDisruptionBudget counts only disruptions that go through the eviction API. If a node stops suddenly, every pod on it is gone at once. Spreading over zones (`topologySpreadConstraints`) is a separate provision for that. With the two pods on different nodes in different zones, the failure of one node loses one of them.

## What stays outside the cluster

<!-- section: 34.data -->

The last section of chapter 12 was about the rules for an old and a new version reading and writing the same data at the same time. Its premise is that the data is outside the task. That does not change on Kubernetes.

Kubernetes can attach volumes to pods and keep a name and data per pod (StatefulSets and PersistentVolumes). Auto Mode has handling of EBS volumes built in. A database can be run inside the cluster.

This chapter does not. If the notes are to be stored, they go in chapter 05's DynamoDB or chapter 13's Aurora, and the pod calls it with its Pod Identity role. There are three reasons.

- A pod is moved to another node at least once every two weeks. An EBS volume lives in one zone, so a pod with data can come back only on a node in that zone
- Backup, restore, encryption, and retention were put together through chapter 22 as features of AWS services. Inside the cluster, the same would have to be put together again with Kubernetes tools
- A cluster that holds no data can be deleted and created again. When upgrading the version looks risky, building a new cluster beside the old one and switching over stays possible

That is why this stack has no resource that holds data. The tests check that no resource in the stack is set to be retained. Do not add to this stack anything it would hurt to delete.
