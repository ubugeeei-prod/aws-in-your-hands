---
title: "34 Kubernetes: Costs, Pitfalls, and Cleanup"
---

# 34 Kubernetes: Costs, Pitfalls, and Cleanup

## Cost

<!-- section: 34.cost -->

Amounts are in USD, for the Tokyo Region, on demand, before tax, with a month of 730 hours. The arithmetic is in [Pricing calculations](/en/reference/pricing.md).

With the stack deployed and no manifest applied, the control plane's USD 73.00 a month is all there is.

The next table is the default layout with the app running and nobody calling it.

| Item | Quantity | Unit price | Per month |
| --- | --- | --- | --- |
| Control plane (standard support) | 730 hours | 0.10 per hour | 73.00 |
| Nodes (t4g.medium) | 2 × 730 hours | 0.0432 per hour | 63.07 |
| Auto Mode management fee | 2 × 730 hours | 0.00518 per hour | 7.56 |
| Ephemeral storage of the nodes | 2 × 20 GB | 0.096 per GB-month | 3.84 |
| ALB | 730 hours | 0.0243 per hour | 17.74 |
| Public IPv4 addresses | (2 ALB + 2 nodes) × 730 hours | 0.005 per hour | 14.60 |
| Subtotal | | | **179.81** |

That is USD 5.91 a day.

Three things can be read from this table.

**It costs about 3.6 times as much as chapter 12.** The same app with the same number of pods was USD 50.33 a month there. Of the difference of USD 129.48, USD 73.00 is the control plane. The rest is the price of nodes far too large for two pods.

**The nodes are mostly empty.** Two nodes of 2 vCPUs each run for the sake of two pods of a quarter vCPU. Fargate bills for the size you use, and in chapter 12 two tasks were USD 17.99 a month. The more pods are packed onto the nodes, the less each pod costs. While there are few pods, nodes do not pay.

**The Auto Mode surcharge is 12% of the instance price.** USD 7.56 a month for two nodes. That is the number to weigh against the time it takes to look after the nodes' operating system, their Kubernetes updates, and the load balancer controller yourself.

Where the nodes are, and how the version is handled, change the total as follows.

| Layout | This chapter | Chapter 11's side | Total |
| --- | --- | --- | --- |
| Default (public subnets) | 179.81 | 0 | 179.81 |
| `--node-subnets private` and one NAT gateway | 172.51 | 49.03 | 221.55 |
| Default layout, on a version in extended support | 544.81 | 0 | 544.81 |

Chapter 11's side in the second row holds the NAT gateway, its Elastic IP address, and the data through the NAT gateway, assumed at 2 GB a month. Each cell is rounded, so the parts and the total differ by a cent.

Some things are not in this table. The nodes' root volume is not included, because its size could not be confirmed. That the ephemeral storage is gp3 is an assumption too. The nodes are priced at the Linux on-demand rate; Auto Mode nodes run Bottlerocket, and whether a separate rate exists for it was not checked. Surplus T4g CPU credits, the ALB's LCUs, logs, data transfer, and the storage in chapter 12's repository are not included either. None of these means zero.

No free allowance is deducted. The EKS pricing page lists none for the cluster hour or for Auto Mode.

**If it gets hammered.** The way in is the same ALB as in chapter 12, with no authentication and no throttling. Every request that arrives reaches a pod.

The fixed cost has a ceiling. This chapter has no setting that adds pods automatically (a HorizontalPodAutoscaler), so there are always two. The node pool's limit is 8 vCPUs, so there are never more than four nodes. Four nodes for a whole month come to USD 261.59; each node is USD 40.89 a month.

LCUs, logs, and data transfer have no ceiling, as in chapter 12. The arithmetic under [Cost](/en/chapters/12-containers/wrap.md) there applies as it stands. In this chapter's layout the pods' logs are not sent to CloudWatch Logs. They stay on the node and are gone with it.

## Coming from Cloudflare or Vercel

<!-- section: 34.others -->

Neither Cloudflare nor Vercel appears to offer a service with a Kubernetes API (as far as their documentation, read on 2026-10-13, shows). Both have ways to run a container without a cluster.

**Cloudflare Containers** starts and controls containers from the code of a Worker. The way in is a Worker, and a container is reached through a Durable Object. The documentation itself draws the contrast: you write TypeScript where you would have written a Kubernetes operator. A container stops while unused, and so does the charge. It is available on the Workers Paid plan. Images are to be built for `linux/amd64`, so this chapter's arm64 image would not run as it is. The FAQ says built-in autoscaling for stateless applications is not available today. Chapter 12's [comparison](/en/chapters/12-containers/wrap.md) has a table that sets it beside ECS.

**Workers** has neither containers nor nodes. The settings this chapter wrote as a Deployment, a Service, an Ingress, a PodDisruptionBudget, and a node pool have nothing to correspond to. If what you build fits within what Workers allows, most of this chapter is something you do not have to think about.

**Vercel** has the Container Runtime of Vercel Functions (beta, on all plans). It builds an image from the project's `Dockerfile.vercel` and runs it as Functions. Scaling is automatic, and billing is by the time the CPU is active. This is not a Kubernetes API either.

Put in one sentence, the difference is who looks after the cluster. On Cloudflare and Vercel, whatever corresponds to a cluster is out of sight, and versions, nodes, and how many may be missing are not your job. On EKS, even with Auto Mode taking the nodes, the day of the version upgrade, the PodDisruptionBudget, the access entries, and the manifests remain your job.

Kubernetes is needed when the Kubernetes API itself is needed: manifests and Helm charts you already have, software distributed as an operator, an organization's tooling built on Kubernetes. If all you want is to run a container, chapter 12's ECS is enough. And if Cloudflare or Vercel fits what you build, staying there is a sound decision.

## Where people get stuck

| If this happens | Look here |
| --- | --- |
| `kubectl` returns an authentication error | The AWS credentials in use have no access entry. Check with `aws sts get-caller-identity` that you are the principal that created the cluster |
| Pods stay Pending | Read the events in `kubectl -n notes describe pod`. Usually there is no node pool (`k8s/cluster.json` was not applied), no node pool fits the `nodeSelector`, or the node pool has reached `limits.cpu` |
| No node starts, or a node starts and does not join | Read `kubectl get nodeclaim` and the Status in `kubectl describe nodeclaim`. Check the access entry for the node role, the subnets' `Name` tags, and the security group ID |
| A pod is in `ImagePullBackOff` | Check that the tag exists in chapter 12's repository, and that the node can reach ECR (private subnets without a NAT gateway) |
| A pod is in `CrashLoopBackOff` | Read `kubectl -n notes logs deployment/notes-api`. Check that an image built for x86 is not being run on an arm64 node |
| The Ingress's `ADDRESS` stays empty | Read the events in `kubectl -n notes describe ingress notes-api`. Check that the IngressClass and IngressClassParams were applied, and that two subnets are found by the `Name` tag |
| The ALB's URL returns an error | See with `aws elbv2 describe-target-health` whether targets are registered and healthy. Check that `/health` returns 200 and that the pods are ready |
| A few requests fail at every rollout | The `preStop` sleep is too short, or `terminationGracePeriodSeconds` is. Check the relations in `src/timing.ts` |
| Node updates make no progress | Look with `kubectl get pdb -A` for a PodDisruptionBudget whose `ALLOWED DISRUPTIONS` is 0 |
| The ALB is still there after `eks:infra:destroy` | The cluster was deleted before the Ingress. Delete the ALB, the target group, and the security group by hand |
| `net:infra:destroy` stops with `StackHasActiveImportsError` | This chapter's stack uses the VPC. Run `eks:infra:destroy` first |
| There is a charge although nothing is in use | The cluster is still there. The control plane alone is USD 73.00 a month |

This table was put together from the documentation. Not one of these was made to happen and observed.

## For production

- **Do not make the creator of the cluster an administrator.** Set `bootstrapClusterCreatorAdminPermissions` to `false` and write the administrators' role as an access entry. Give the deploy role the inside of a namespace only
- **Narrow the API endpoint.** As it is, the cluster's API can be reached from the internet (authentication is required). Limit the sources with `publicAccessCidrs`, or close the public endpoint and use the cluster from inside the VPC
- **Put the nodes in private subnets.** Use `--node-subnets private` with chapter 11's NAT gateway or endpoints
- **Leave a range of instance types.** A node pool narrowed to one type depends on that type's stock. Use three zones as well
- **Use HTTPS, and put throttling at the entrance.** Write the certificate in `IngressClassParams`, and attach AWS WAF with an annotation on the Ingress (chapter 21)
- **Send logs and metrics somewhere.** As it is, the pods' logs exist only on the node. The control plane's logs are not enabled either (chapter 19)
- **Fit the number of pods to the load.** Add a HorizontalPodAutoscaler. This chapter has none
- **Restrict pod-to-pod traffic with NetworkPolicy.** As it is, pods in the cluster can talk to each other freely
- **Deploy through GitOps or a pipeline.** As it is, `kubectl apply` is run from a laptop, and nothing guarantees that what was applied is what the repository holds (chapter 20)
- **Decide the day of the upgrade in advance.** Do not wait for the end of standard support; upgrade a cluster kept for trying things first
- **Keep data outside the cluster.** As the last section of [Build, Continued](/en/chapters/34-eks/more.md) says
- **Deploy through AWS CDK CLI and CloudFormation.** cdkd's own documentation describes cdkd as intended for development and testing and recommends AWS CDK CLI for production (chapter 02)

## Cleanup

<!-- section: 34.cleanup -->

The cleanup has an order. **Delete the Ingress first.** The ALB was created not by the stack but by Auto Mode, from the Ingress. The EKS documentation says that if you delete the cluster without deleting the Ingress, the ALB remains. On the same page, the part about Auto Mode says that deleting the cluster deletes all load balancers. Which of the two happens was not checked, so this chapter deletes the Ingress first.

```bash
kubectl -n notes delete ingress notes-api
aws elbv2 describe-load-balancers --region ap-northeast-1
```

Wait until this chapter's ALB is gone from the output of the second command, then delete the rest.

```bash
vp run eks:manifests app --tag v1 | kubectl delete -f - --ignore-not-found
vp run eks:manifests cluster | kubectl delete -f - --ignore-not-found
vp run eks:infra:destroy
```

Once there are no pods, Auto Mode stops the nodes. The documentation says that deleting the cluster also deletes any nodes that are left.

To delete chapter 12's and chapter 11's stacks as well, keep this order. Chapter 11's destroy is refused while a stack that uses the VPC remains.

```bash
vp run ecs:infra:destroy
vp run net:infra:destroy
```

Finally, check for yourself.

```bash
aws eks list-clusters --region ap-northeast-1
aws elbv2 describe-load-balancers --region ap-northeast-1
aws elbv2 describe-target-groups --region ap-northeast-1
```

If `aih-eks` is not in the first and nothing of this chapter is in the second and third, the hourly charges have stopped.

Nodes have become hard to check in the EC2 console or with `aws ec2 describe-instances`. Since April 22, 2026, instances created by Auto Mode are not listed by default. The documentation says they can be seen on the cluster's page in the EKS console, or with the `include-managed-resources` parameter of `DescribeInstances`. Check the next day's bill as well for anything left after the cluster was deleted.

Your local kubeconfig keeps the settings of the deleted cluster. They do no harm, but they remain `kubectl`'s default target, so switch when you use another cluster.

::: details Verification notes for this chapter

**Checked locally.** The unit tests (87). That the manifests fit this chapter's schemas, the references between objects, the files in `k8s/` against the generators, and that the schemas and the reference checks report each mistake. The arithmetic of rolling updates, PodDisruptionBudgets, and drains. The relations between durations (including chapter 12's rules). The date arithmetic of support windows. The amounts in the text against the values `tools/src/pricing/calc.ts` computes from Price List unit prices. The stack assertions. The type check. `eks:infra:synth` (without context and with `-c deployRoleArn=...`; also that a value that is not a role ARN is refused). `eks:render`. `eks:manifests` with every value given as a flag, and that the tag `latest` is refused. That `vp check --fix` (including awscdk-lint) passes without warnings on this chapter's paths. Synthesizing `eks.Cluster` of `aws-eks` and `Cluster` of `aws-eks-v2` from aws-cdk-lib 2.273.0 with chapter 11's VPC, and reading the resource types and the managed policies on the roles.

**Not checked yet.** No cluster was ever created. Everything below waits for a check on real AWS. That cdkd 0.296.28 can create, update, and delete `AWS::EKS::Cluster`, `AWS::EKS::AccessEntry`, and `AWS::EKS::PodIdentityAssociation` through Cloud Control API. That an Auto Mode cluster without built-in node pools can be created with this combination of properties (including what happens when `bootstrapSelfManagedAddons` is left out). That chapter 11's VPC can be read with `Fn::ImportValue` from another app's stack. That nodes can join with the control plane's network interfaces in private subnets and the nodes in public ones. That the API server accepts the manifests in `k8s/`. That `t4g.medium` nodes start from the custom node class, that subnets can be selected by the `Name` tag, and that `associatePublicIPAddress` takes effect. That the node role's two policies are enough. That an ALB is created from the Ingress, that `subnets.matchTags` in `IngressClassParams` works with the `Name` tag, and that the seven Ingress annotations take effect under Auto Mode. That 15 seconds of `preStop` and 30 seconds of `minReadySeconds` leave no failed request during a rollout (the 10 seconds of `deregistrationLag` are an assumption). That a `sleep` in `preStop` is accepted by a 1.37 cluster. That chapter 12's image runs with `runAsUser: 1000` and a read-only filesystem. That the Pod Identity association delivers credentials to a pod. That the five objects in `k8s/app.json` can be applied with `AmazonEKSEditPolicy` limited to the namespace. That a PodDisruptionBudget acts during a drain as calculated. That a deploy with a higher `KUBERNETES_VERSION` goes through as an update of the cluster. The order of the cleanup, and whether the ALB remains when the Ingress is not deleted. The symptoms under "Where people get stuck".

Not confirmed from a primary source. Whether Auto Mode's built-in load balancing handles the Gateway API. Whether pod readiness gates are available in Auto Mode. The size of a node's root volume, and the type of the ephemeral storage (gp3 assumed). That the Linux rate applies to Bottlerocket nodes. What happens to pods held back by a PodDisruptionBudget when a node reaches the 21-day limit. What Kubernetes does when `maxSurge` and `maxUnavailable`, as percentages, both come to 0 (the code refuses it). How `include-managed-resources` of `DescribeInstances` is written in the AWS CLI. Cloudflare and Vercel were read about, not used.

Resource types cdkd handles. The `dist` of the installed npm package (0.296.28) was read; the bundle keeps the names of the source files. No SDK provider registers a type that begins with `AWS::EKS`. `AWS::EKS::Cluster`, `AccessEntry`, and `PodIdentityAssociation` are not on the list of types Cloud Control API cannot handle (`unsupported-types.generated.ts`), so they go through Cloud Control API. `slow-cc-operation-timeouts.ts` gives `AWS::EKS::Cluster` 30 minutes each to create and delete, and `protection-flags.ts` knows `DeletionProtection` as its deletion protection property. `AWS::IAM::Role` has a provider of its own that handles `AssumeRolePolicyDocument` and `ManagedPolicyArns`.

**Where the code is.**

| Section | Files | `vp run` tasks |
| --- | --- | --- |
| The whole picture | `examples/34-eks/infra/lib/eks-stack.ts`, `src/config.ts`, `k8s/` | `eks:infra:synth` |
| What the control plane costs | `examples/34-eks/src/cost.ts`, `test/pricing.test.ts` | `test:unit` |
| How nodes are provided | `examples/34-eks/src/manifests.ts`, `src/config.ts`, `k8s/cluster.json`, `test/manifests.test.ts` | `test:unit`, `eks:render` |
| The cluster in CDK | `examples/34-eks/infra/lib/eks-stack.ts`, `infra/bin/app.ts`, `infra/test/eks-stack.test.ts` | `eks:infra:synth`, `test:unit` |
| How people and the deploy role get in | `examples/34-eks/infra/lib/eks-stack.ts`, `src/config.ts`, `infra/test/eks-stack.test.ts` | `test:unit` |
| What a pod may do in AWS | `examples/34-eks/infra/lib/eks-stack.ts`, `infra/test/eks-stack.test.ts` | `test:unit` |
| Manifests written in typed code | `examples/34-eks/src/k8s/schema.ts`, `src/k8s/check.ts`, `src/manifests.ts`, `src/rendered.ts`, `scripts/render.ts`, `k8s/`, `test/manifests.test.ts` | `test:unit`, `eks:render` |
| The way in | `examples/34-eks/src/manifests.ts`, `k8s/app.json`, `k8s/cluster.json` | `test:unit` |
| When a pod is stopped | `examples/34-eks/src/timing.ts`, `test/timing.test.ts`, `examples/12-containers/src/timing.ts` | `test:unit` |
| How many pods may be missing at once | `examples/34-eks/src/rollout.ts`, `test/rollout.test.ts`, `src/config.ts` | `test:unit` |
| What stays outside the cluster | `examples/34-eks/infra/lib/eks-stack.ts` | |
| Checking on a laptop | `examples/34-eks/test/`, `infra/test/eks-stack.test.ts`, `scripts/render.ts` | `test:unit`, `eks:render`, `eks:infra:synth` |
| Deploying | `examples/34-eks/infra/bin/app.ts`, `cdk.json`, `scripts/manifests.ts`, `tools/src/infra/` | `eks:infra:diff`, `eks:infra:deploy`, `eks:manifests`, `eks:infra:drift` |
| Upgrading the version | `examples/34-eks/src/support.ts`, `test/support.test.ts`, `src/config.ts` | `test:unit` |
| Cost | `examples/34-eks/src/cost.ts`, `test/pricing.test.ts`, `data/pricing/` | `test:unit` |
| Cleanup | `tools/src/infra/` | `eks:infra:destroy` |

**Primary sources** (all checked on 2026-10-13)

- EKS as a whole: [Amazon EKS architecture](https://docs.aws.amazon.com/eks/latest/userguide/eks-architecture.html), [Manage compute resources by using nodes](https://docs.aws.amazon.com/eks/latest/userguide/eks-compute.html), [Simplify compute management with AWS Fargate](https://docs.aws.amazon.com/eks/latest/userguide/fargate.html), [Simplify node lifecycle with managed node groups](https://docs.aws.amazon.com/eks/latest/userguide/managed-node-groups.html)
- Auto Mode: [Automate cluster infrastructure with EKS Auto Mode](https://docs.aws.amazon.com/eks/latest/userguide/automode.html), [Create a Node Pool](https://docs.aws.amazon.com/eks/latest/userguide/create-node-pool.html), [Enable or Disable Built-in NodePools](https://docs.aws.amazon.com/eks/latest/userguide/set-builtin-node-pools.html), [Create a Node Class](https://docs.aws.amazon.com/eks/latest/userguide/create-node-class.html), [Managed instances](https://docs.aws.amazon.com/eks/latest/userguide/automode-learn-instances.html), [VPC Networking and Load Balancing](https://docs.aws.amazon.com/eks/latest/userguide/auto-networking.html), [Create an IngressClass to configure an Application Load Balancer](https://docs.aws.amazon.com/eks/latest/userguide/auto-configure-alb.html), [Tag subnets](https://docs.aws.amazon.com/eks/latest/userguide/tag-subnets-auto.html), [cluster IAM role](https://docs.aws.amazon.com/eks/latest/userguide/auto-cluster-iam-role.html), [node IAM role](https://docs.aws.amazon.com/eks/latest/userguide/auto-create-node-role.html), [Create a cluster with the AWS CLI](https://docs.aws.amazon.com/eks/latest/userguide/automode-get-started-cli.html), [Enable on an existing cluster](https://docs.aws.amazon.com/eks/latest/userguide/auto-enable-existing.html), [Update the Kubernetes version](https://docs.aws.amazon.com/eks/latest/userguide/auto-upgrade.html)
- Permissions: [EKS Pod Identity](https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html), [Assign an IAM role to a Kubernetes service account](https://docs.aws.amazon.com/eks/latest/userguide/pod-id-association.html), [How EKS Pod Identity works](https://docs.aws.amazon.com/eks/latest/userguide/pod-id-how-it-works.html), [Set up the Pod Identity Agent](https://docs.aws.amazon.com/eks/latest/userguide/pod-id-agent-setup.html), [Service accounts (comparison with IRSA)](https://docs.aws.amazon.com/eks/latest/userguide/service-accounts.html), [Assign IAM roles to Kubernetes service accounts (IRSA)](https://docs.aws.amazon.com/eks/latest/userguide/associate-service-account-role.html), [Access entries](https://docs.aws.amazon.com/eks/latest/userguide/access-entries.html), [Access policy permissions](https://docs.aws.amazon.com/eks/latest/userguide/access-policy-permissions.html), [Connect kubectl to an EKS cluster](https://docs.aws.amazon.com/eks/latest/userguide/create-kubeconfig.html), [Set up kubectl](https://docs.aws.amazon.com/eks/latest/userguide/install-kubectl.html)
- Versions: [Kubernetes version lifecycle on EKS](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html), [Disable EKS extended support](https://docs.aws.amazon.com/eks/latest/userguide/disable-extended-support.html), [Update existing cluster](https://docs.aws.amazon.com/eks/latest/userguide/update-cluster.html), [Roll back a cluster](https://docs.aws.amazon.com/eks/latest/userguide/rollback-cluster.html), [Delete a cluster](https://docs.aws.amazon.com/eks/latest/userguide/delete-cluster.html)
- The way in: [AWS Load Balancer Controller](https://docs.aws.amazon.com/eks/latest/userguide/aws-load-balancer-controller.html), [Ingress annotations](https://github.com/kubernetes-sigs/aws-load-balancer-controller/blob/main/docs/guide/ingress/annotations.md) (the documentation of the open source controller)
- CloudFormation: [AWS::EKS::Cluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-eks-cluster.html), with the pages for ComputeConfig, AccessConfig, and UpgradePolicy
- Kubernetes: [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/), [Specifying a Disruption Budget](https://kubernetes.io/docs/tasks/run-application/configure-pdb/), [Disruptions](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/), [API-initiated Eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/api-eviction/), [Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/), [Container Lifecycle Hooks](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/), [Pod Topology Spread Constraints](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/), [kubectl apply](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_apply/), [kubectl diff](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/)
- Pricing: [Amazon EKS pricing](https://aws.amazon.com/eks/pricing/), [Amazon ECS pricing](https://aws.amazon.com/ecs/pricing/), and the AWS Price List bulk API for [EKS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEKS/current/ap-northeast-1/index.json) (published 2026-09-28) and [EC2](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.json) (published 2026-10-09). The unit prices for the ALB, public IPv4 addresses, gp3, and the NAT gateway were fetched for earlier chapters
- [docker-node: Best Practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md) (the uid of the `node` user)
- Cloudflare Containers: [Overview](https://developers.cloudflare.com/containers/), [Lifecycle of a Container](https://developers.cloudflare.com/containers/platform-details/architecture/), [FAQ](https://developers.cloudflare.com/containers/faq/)
- Vercel: [Container Runtime](https://vercel.com/docs/functions/runtimes/container), [Runtimes](https://vercel.com/docs/functions/runtimes)
- [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0) (the type definitions and source of `aws-eks` and `aws-eks-v2`, and the synthesis results), [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28) (the `dist` bundle)

:::
