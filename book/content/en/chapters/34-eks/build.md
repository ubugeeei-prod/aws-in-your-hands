---
title: "34 Kubernetes: Design and Build"
---

# 34 Kubernetes: Design and Build

This page covers what is created on the AWS side. It decides how nodes are provided, writes the cluster in CDK, and prepares the way in for people and the deploy role, and the way out to AWS for pods. The Kubernetes manifests are written on the [next page](/en/chapters/34-eks/more.md).

## How nodes are provided

<!-- section: 34.nodes -->

On EKS, AWS runs the control plane, but how the nodes that carry your pods are provided is your choice. Today's documentation describes three main ways.

| | EKS Auto Mode | Managed node groups | Fargate profiles |
| --- | --- | --- | --- |
| What a node is | An EC2 instance that EKS starts | An EC2 instance; you decide how many and which type | An environment provided per pod |
| Scaling | Starts a node when a pod has nowhere to go, stops it when it empties | An Auto Scaling group. To follow the pods you install Cluster Autoscaler or similar yourself | One per pod |
| OS and node updates | EKS does them. A node lives 21 days at most | You start the AMI and version updates | AWS does them |
| Load balancer integration | Built in | You install AWS Load Balancer Controller | You install it as well |
| arm64 | Yes | Yes | No |
| EKS Pod Identity | Built in | Yes, once you install the agent | No |
| Surcharge | About 12% of the instance price | None | Hourly price per vCPU and GB of memory |

This chapter uses **Auto Mode**, for three reasons.

The first is that chapter 12's image is arm64. The comparison table for Fargate profiles says they cannot run workloads that need Arm processors. Pods on Fargate can also be placed only in private subnets, and a NAT gateway is assumed. Choosing Fargate here because chapter 12 used it would bring a rebuilt image and a NAT gateway at USD 48.91 a month.

The second is that fewer components have to be installed in the cluster and looked after. With managed node groups you install the load balancer controller, something to add and remove nodes, and the Pod Identity agent, and at every Kubernetes upgrade you check which version of each one fits. In Auto Mode these are features of EKS.

The third is that there are no nodes when nobody uses the cluster. Auto Mode starts a node only while a pod has nowhere to run.

Managed node groups are the choice when you want to get at the nodes. Auto Mode nodes cannot be reached by SSH or Session Manager, you cannot choose their AMI or CNI, and they do not run Windows containers. Security groups can differ per node class but not per pod. If you run into one of these, looking after nodes yourself and not paying the 12% fits better.

### Why the node pool is written by hand

Auto Mode has two built-in node pools. `general-purpose`, the one for applications, starts amd64 instances only. To run an arm64 image the node pool has to be your own.

So this stack disables both built-in node pools. That also means no default node class is created. The node class (which subnets, which role) and the node pool (which instances, how many) are provided as manifests.

<<< @/examples/34-eks/src/manifests.ts{nodes}

The node pool's `requirements` say which instances may be started: arm64, on demand, `t4g.medium`. Auto Mode does not use instances with a single vCPU, or the sizes nano, micro, and small. `t4g.medium` (2 vCPUs, 4 GiB) is one of the smallest arm64 instances it will use.

Narrowing to one instance type is a shortcut for practice. In a zone that has none of that type in stock, no node can be started. In production you leave a range of generations and sizes and let Auto Mode choose. T4g runs on CPU credits, so a workload that keeps the CPU busy pays separately for surplus credits ([chapter 23](/en/chapters/23-ec2.md)).

`limits.cpu` is the total number of vCPUs this node pool may start. At 8, that is four nodes. Like `maxCount` in chapter 12, it is also a ceiling on the bill.

### Which subnets the nodes go in

A node pulls images from ECR when it starts, and connects to the control plane. As with chapter 12's tasks, a node in a private subnet needs a route out.

By default the nodes go where chapter 12's tasks went, in chapter 11's public subnets, each with a public IP address (`associatePublicIPAddress`). Nothing has to be added to chapter 11, and the only hourly charge is for the addresses. What decides inbound traffic is the security group, and the nodes use the cluster security group that EKS creates.

To put them in private subnets, deploy chapter 11 with `-c egress=nat` and add `--node-subnets private` when printing the manifests. Only the subnets the node class selects, and whether a node gets an address, change.

The subnets are selected by the `Name` tag chapter 11 gave them (`AihNetwork/Public1` and so on). No ID has to be written, so the manifests can be kept in the repository.

## The cluster in CDK

<!-- section: 34.cdk -->

CDK has three ways to create an EKS cluster. All three were synthesized with the pinned version (aws-cdk-lib 2.273.0) and the templates compared.

| | `eks.Cluster` in `aws-eks` | `Cluster` in `aws-eks-v2` | `eks.CfnCluster` in `aws-eks` |
| --- | --- | --- | --- |
| Type of the cluster | `Custom::AWSCDK-EKS-Cluster` | `AWS::EKS::Cluster` | `AWS::EKS::Cluster` |
| What comes with it | Two nested stacks, with Lambda functions in them | A security group and an SSM parameter | Nothing |
| Auto Mode | No setting | On by default | Written as properties |
| `upgradePolicy` and deletion protection | No setting | No setting | Written as properties |

The first, `eks.Cluster`, does not create the cluster as a CloudFormation resource. It creates it through a custom resource run by Lambda, and no `AWS::EKS::Cluster` appears in the template. What cdkd manages is the Lambda functions and the nested stacks; the cluster itself is no longer a CloudFormation resource. Applying manifests from CDK also works by running a Lambda function that carries kubectl. That is too many moving parts for creating one cluster in this book.

The second, `aws-eks-v2`, creates the cluster as `AWS::EKS::Cluster` and uses no custom resource. It is a strong candidate, but in the pinned version three things did not fit. The policies it attaches to the Auto Mode roles differ from the list in today's user guide (it attaches `AmazonEKSBlockStoragePolicy` and `AmazonEKSWorkerNodePolicy`, where the guide names `AmazonEKSBlockStoragePolicyV2` and `AmazonEKSWorkerNodeMinimalPolicy`). It has nowhere to write `upgradePolicy` or deletion protection. And the settings this chapter wants to explain would be hidden in the construct's defaults.

This chapter uses the third, **`eks.CfnCluster`**. It writes the CloudFormation properties as they are, so what the template holds and what the page explains correspond one to one.

<<< @/examples/34-eks/infra/lib/eks-stack.ts{cluster}

Auto Mode is switched on by three settings: `computeConfig`, `elasticLoadBalancing`, and `blockStorage`. The rule is that all three are enabled together, in the same request. `computeConfig` names no `nodePools`, so no built-in node pool is created.

`bootstrapSelfManagedAddons` says whether the VPC CNI, CoreDNS, and kube-proxy are installed into the cluster. In Auto Mode they run on the node itself, so it is `false`. The pinned `aws-eks-v2` fails synthesis when this is `true` with Auto Mode. What happens when it is left out was not checked.

This is the role the cluster uses.

<<< @/examples/34-eks/infra/lib/eks-stack.ts{cluster-role}

EKS uses this role when it starts nodes, creates load balancers, and attaches volumes. It carries five policies managed by AWS. That departs from the practice kept since chapter 04 of writing out only the actions needed, but what Auto Mode needs spans a wide part of EC2 and ELB and changes on AWS's side, so here the managed policies are left to do it.

### Whether cdkd can create it

Reading the source of the pinned cdkd (0.296.28), there is no provider of its own for any `AWS::EKS` type. The three this stack uses, `AWS::EKS::Cluster`, `AWS::EKS::AccessEntry`, and `AWS::EKS::PodIdentityAssociation`, all go through Cloud Control API. None is on cdkd's list of types it cannot handle, and for `AWS::EKS::Cluster` there is a setting that waits up to 30 minutes each for creation and deletion. `AWS::IAM::Role` has a provider of its own.

That is as far as reading goes. **Whether the cluster can in fact be created was not checked, because nothing was deployed.** The tests pin that the stack uses these four resource types and no others, and that it contains no custom resource, no Lambda function, and no nested stack.

## How people and the deploy role get in

<!-- section: 34.access -->

Who may call the cluster's API is a setting apart from IAM policies. Being allowed `eks:*` in IAM does not help if the cluster does not know you: `kubectl` is refused.

In today's EKS this mapping is written as **access entries**. An access entry ties an IAM role or user to permissions inside Kubernetes, and it is managed through the EKS API. It used to be done by editing a ConfigMap named `aws-auth` inside the cluster by hand. A wrong edit could lock everyone out, and repairing it required getting into the cluster. This stack sets `authenticationMode` to `API` and uses access entries only. The default for a cluster created through CloudFormation is `CONFIG_MAP`, the ConfigMap alone, which is why it is set explicitly.

Three parties can get into this stack's cluster.

**Whoever created the cluster.** `bootstrapClusterCreatorAdminPermissions` is `true`, so the IAM principal that ran the deploy becomes a cluster administrator. That is convenient for practice, but in production it means the deploy role of [chapter 20](/en/chapters/20-shipping.md) is an administrator. In production set it to `false` and write the administrators' role as an access entry of its own.

**The nodes.** For the role of a node class you wrote yourself, EKS creates no access entry. Without one, the nodes start and cannot join the cluster.

<<< @/examples/34-eks/infra/lib/eks-stack.ts{node-role}

**The deploy role.** The role that releases the app gets permission to change what is inside the app's namespace, and no more.

<<< @/examples/34-eks/infra/lib/eks-stack.ts{deploy-access}

`AmazonEKSEditPolicy` can create and change Deployments, Services, Ingresses, PodDisruptionBudgets, and service accounts, but can only read namespaces. With the scope limited to the namespace `notes`, this role cannot touch the node pool or any other namespace.

The manifests are split in two along the same line. The namespace, the node class, the node pool, and the IngressClass act on the whole cluster, so an administrator applies them once. The Deployment and the rest are applied by the deploy role on every release.

The role's ARN is given at deploy time.

<<< @/examples/34-eks/src/config.ts{schema}

The tests check that the role given gets `AmazonEKSEditPolicy` limited to the namespace and nothing else, and that `AmazonEKSClusterAdminPolicy` appears nowhere in the template.

## What a pod may do in AWS

<!-- section: 34.pod-identity -->

A task in chapter 12 had two roles: the task execution role, for pulling the image and writing logs, and the task role, for the code's own calls to AWS. EKS divides things the same way.

Pulling the image is the node role's job. That is the `AmazonEC2ContainerRegistryPullOnly` on `NodeRole` in the previous section.

The code's permission to call AWS is given through **EKS Pod Identity**. Giving the app's permissions to the node role is not the way: a node carries several pods, so a permission on the node role belongs to no pod in particular. Auto Mode nodes limit the hop count to the instance metadata to 1, so an ordinary pod cannot fetch the node role's credentials anyway. Pod Identity hands each pod a role of its own.

<<< @/examples/34-eks/infra/lib/eks-stack.ts{pod-identity}

The association is one line: pods of this service account, in this namespace, in this cluster, get this role. When the Deployment names the same service account for its pods, EKS puts the place to fetch credentials from into the pod's environment variables, and the AWS SDK uses it by its default chain.

This app calls no AWS API, so, like the task role in chapter 12, the role has no permissions. To connect chapter 05's table you would write `table.grantReadWriteData(podRole)`.

### How IRSA differs

The older way to do the same is IRSA (IAM roles for service accounts). You create an IAM OIDC provider for each cluster, and in the role's trust policy you write that cluster's OIDC URL and the names of the namespace and the service account. On the service account you write the role's ARN as an annotation.

| | EKS Pod Identity | IRSA |
| --- | --- | --- |
| Who the trust policy names | `pods.eks.amazonaws.com` only | The OIDC provider of each cluster |
| When the cluster is recreated | Recreate the association. The role does not change | Rewrite the role's trust policy |
| Where the link is written | The EKS API (inside this stack) | The trust policy, and an annotation on the service account |
| Where it works | EKS nodes on EC2 only. Not for pods on Fargate | Kubernetes outside EKS as well |

The AWS documentation recommends Pod Identity wherever it can be used. This chapter took it for the role's trust policy no longer depending on the cluster: recreate the cluster and the role still works. IRSA remains for pods on Fargate, and for using the same mechanism on clusters outside EKS.

Pod Identity does not make a container a security boundary. Pods on the same node share a kernel, and the documentation says so too.

The tests check that only `pods.eks.amazonaws.com` can assume the pod role, that the namespace and service account of the association are those of the Deployment, and that the stack has no OIDC provider. If the names disagree, neither side reports an error. The pod simply runs without permissions, so a test pins it.
