---
title: "34 Kubernetes: EKS, Auto Mode, Pod Identity, and ALB"
sourceRevision: 2
---

# 34 Kubernetes: EKS, Auto Mode, Pod Identity, and ALB

This chapter takes the notes API that chapter 12 put in a container and runs the same image on Amazon EKS. What ECS did with a task definition and a service is done on Kubernetes by a handful of objects, and the chapter matches them up one by one.

The cluster in this chapter is the most expensive thing in the book to leave running. **From the moment the cluster exists it costs USD 0.10 an hour, USD 73.00 a month, whether or not anyone calls it. With the app on it, nodes and a load balancer bring that to about USD 0.25 an hour, USD 5.91 a day, USD 179.81 a month** (Tokyo, default layout; the breakdown is under [Cost](/en/chapters/34-eks/wrap.md)). Chapter 12's ECS service ran the same app for USD 50.33 a month. When you are done trying it, go through the [cleanup](/en/chapters/34-eks/wrap.md) the same day. The cleanup has an order: if the Ingress is not deleted first, the load balancer may stay behind.

You need the VPC from [chapter 11](/en/chapters/11-network.md) and the image from [chapter 12](/en/chapters/12-containers.md). The code is in `examples/34-eks/`.

No cluster was ever created for this chapter. What was checked on a laptop is the synthesis of the stack, the tests, the checks on the manifests, and the arithmetic. How it behaves on AWS is written from the documentation and from the source of the pinned cdkd and CDK.

## When ECS is enough, and when to choose Kubernetes

<!-- section: 34.when -->

If chapter 12's setup gives you no trouble, there is no reason to move to Kubernetes. An ECS service already keeps a set number of containers running behind an ALB and replaces them without stopping. ECS charges nothing for the cluster itself, and it has no version to upgrade.

What Kubernetes gives you is the Kubernetes API.

- Tools and components that speak that API become available. Helm charts, GitOps tools such as Argo CD, and operators for databases and messaging are distributed on the assumption that there is a Kubernetes API. If what you want exists only for Kubernetes, that is a reason
- You can say in detail where things run. A DaemonSet that puts one copy on every node, spreading across zones, and the number of pods that may be missing while nodes are replaced (the PodDisruptionBudget of this chapter) are all Kubernetes objects
- What already runs on Kubernetes can be brought over without rewriting it. For an organization that wants the same manifests on another cloud or on its own clusters, this is the main reason. The load balancer and node settings are specific to EKS, though, so not every manifest works unchanged
- One cluster can be shared by several teams, divided by namespaces and permissions

What you take on in exchange is just as clear.

- Each cluster costs USD 73.00 a month for its control plane. ECS has no charge that corresponds to it
- A Kubernetes version has an end date. EKS standard support lasts 14 months from release; after that the price is six times as high, or the cluster is upgraded for you (the [Deploy](/en/chapters/34-eks/deploy.md) page covers this)
- There are two permission systems: IAM, and the permissions inside Kubernetes. The settings that join them are written separately for people and the deploy role, and for pods
- State lives in two places. The stack creates the cluster and no more; the nodes and the load balancer are created afterwards by EKS, from the manifests. They are not in cdkd's state

The app in this chapter is on the side where ECS is enough. It goes on EKS anyway, so that the two can be laid side by side. If, at the end, you can tell which side the thing you are building is on, the chapter has done its job.

## The whole picture

<!-- section: 34.architecture -->

```figure
caption: Requests go from the Application Load Balancer straight to the pods. AWS runs the control plane, and EKS Auto Mode starts nodes to fit the number of pods
node client: Client | curl
node alb: Application Load Balancer | created by Auto Mode from the Ingress
node cp: Control plane | API server and etcd, managed by AWS
node p1: Pod | AZ 1a
node p2: Pod | AZ 1c
node ecr: ECR repository | chapter 12's stack
edge client -> alb: HTTP :80
edge alb -> p1: HTTP :8080, target type ip
edge alb -> p2
edge cp --> p1: the kubelet takes its orders
edge cp --> p2
edge p1 -> ecr: image pull
group nodes: Nodes: one t4g.medium per zone = p1, p2
mark cp
```

```figure
caption: The stack creates the cluster and IAM, and stops there. The nodes and the load balancer are created by EKS Auto Mode once the manifests are applied, and they are not in cdkd's state
node stack: Stack AihEks | deployed by cdkd
node admin: k8s/cluster.json | applied once by a cluster administrator
node app: k8s/app.json | applied by the deploy role on every release
node auto: What Auto Mode creates | EC2 instances, ALB, target group
edge stack -> admin: cluster, roles, access entries
edge admin -> app: namespace, node pool, IngressClass
edge app --> auto: pods are Pending, an Ingress exists
```

The terms in the figures, next to the ECS terms of chapter 12.

The **control plane** is the Kubernetes API server and etcd, which holds the cluster's state. On EKS, AWS runs it across three Availability Zones, and all you see is the API endpoint. ECS has a managing side too, but you never see it and it costs nothing. On EKS it is billed by the hour, per cluster.

A **pod** is the smallest thing Kubernetes runs, and corresponds to an ECS task. A **Deployment** is the instruction to keep a set number of pods running and to replace them when the image changes; it corresponds to an ECS service. The image, CPU, memory, and environment variables that went into the task definition go into the pod template inside the Deployment.

A **node** is a machine that pods run on; on EKS, an EC2 instance. With Fargate in chapter 12 each task got an environment of its own and there was no machine to think about. On Kubernetes several pods share a node's CPU and memory. This chapter leaves starting and replacing nodes to **EKS Auto Mode**.

A **Service** and an **Ingress** decide where traffic goes. A Service gives a set of pods a name, and an Ingress says which Service HTTP from outside is sent to. On EKS a controller reads the Ingress and creates the ALB and its target group. The load balancer that chapter 12 wrote in its stack is created here from a manifest.

The size and number of pods are the same as in chapter 12.

<<< @/examples/34-eks/src/config.ts{size}

`POD` is computed from chapter 12's `TASK`. A quarter of a vCPU is written `250m` in Kubernetes: 250 thousandths. `NODES` holds what Auto Mode may start. It is narrowed to one instance type so that the cost of leaving the cluster running is a number this book can print.

One thing has not changed since chapter 12. The notes are still in the pod's memory, and two pods mean two `Map`s. Putting the data outside the cluster is the subject of the last section of [Build, Continued](/en/chapters/34-eks/more.md).

## What the control plane costs

<!-- section: 34.control-plane -->

An EKS cluster costs USD 0.10 an hour from the moment it is created. That is the same with no node and no pod. Left for a month it comes to USD 73.00, more than the whole of chapter 12's setup (USD 50.33).

This chapter's stack disables the built-in node pools. With the stack deployed and nothing else done, the control plane is all that is billed. The charges for nodes and the load balancer begin when the manifests are applied.

The price also depends on the cluster's Kubernetes version. A cluster left on a version that is past standard support pays USD 0.50 an hour more, USD 0.60 in all: a difference of USD 365.00 a month. This stack is set so that EKS upgrades the version by itself before that surcharge begins (`upgradePolicy` is `STANDARD`). The default for a cluster created through CloudFormation is `EXTENDED`: pay the surcharge and stay on the version.

How the hourly items are counted is in code.

<<< @/examples/34-eks/src/cost.ts{billable}

The tests check that the hours this function returns match the scenarios in the pricing data, and that the amounts printed in this chapter match what is calculated.
