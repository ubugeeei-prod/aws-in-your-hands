---
title: "67 Firecracker: Costs, Pitfalls, and Cleanup"
---

# 67 Firecracker: Costs, Pitfalls, and Cleanup

The last page of the chapter: prices, pitfalls, cleanup, and the verification notes.

## Prices

<!-- section: 67.cost -->

Firecracker itself is open source under the Apache License 2.0 and has no price. What costs money is the machine it runs on. Trying it on a Linux machine of your own incurs no AWS charge.

The stack of the previous page creates no instance by default. The launch template, the security group, the role and the instance profile have no price, and the bucket costs only S3 storage for a kit of some tens of kilobytes while it is there.

With `-c run=true` the prices are these. The unit prices are On-Demand list prices in the Tokyo Region, checked in the AWS Price List on October 13, 2026 (published 2026-10-09).

| Case | Items | List subtotal |
| --- | --- | ---: |
| Destroyed after two hours | c7i.large for two hours 0.22, public IPv4 address 0.01, 16 GiB of gp3 0.004 | USD 0.24 |
| Forgotten for a month (730 hours) | c7i.large 82.02, public IPv4 address 3.65, 16 GiB of gp3 1.54 | USD 87.20 |
| For comparison: c5.metal for two hours | The instance-hour price only | USD 10.27 |

Data transfer for the downloads, Session Manager, and whatever is in the chapter 11 network are not included. No free allowance was deducted, because none could be confirmed for c7i.large. Stopping the instance still leaves the root volume billed. The EC2 guide says nested virtualization has no additional cost.

The prices of the other services this chapter names were not looked into. The announcement says Lambda MicroVMs are on the Lambda pricing page. The guide says SnapStart charges for caching a snapshot and for restoring from it.

## Pitfalls

| Symptom | What to check |
| --- | --- |
| `firecracker:boot did not run` | It is not Linux, or `/dev/kvm` cannot be read and written. `firecracker:plan` only prints the same requests and runs anywhere |
| It stops with `got no answer` | Firecracker is not listening, or the socket path differs, or the privileges do. The quickstart says to call with `sudo` when Firecracker was started with `sudo` |
| A configuration call is refused with 400, saying it can only be sent before the boot | That process has already booted its guest. A Firecracker process serves one microVM, once: start a new process |
| `InstanceStart` is refused | The path of the kernel or of the root drive is wrong. Paths are seen from the working directory of the Firecracker process |
| It stops after 30 seconds with no answer from the guest | The guest booted, and the server is not running or the network is not connected. Read the console output in the terminal where Firecracker runs, and `ip addr show tap0` |
| Nothing appears on the console | The boot arguments lack `console=ttyS0`. According to the FAQ the console is disabled by default |
| The instance has no `/dev/kvm` | Nested virtualization is not enabled, or the instance type does not support it. The EC2 guide says `ProcessorInfo.SupportedFeatures` of `aws ec2 describe-instance-types` tells |
| `firecracker:spec` fails | The checksum of the downloaded specification differs, or the subset cut from it differs from the committed JSON. To move to a new release, change the version, URL and checksum in `SPEC`, rewrite with `--write`, and read the difference |

## Cleanup

<!-- section: 67.cleanup -->

On your own machine, stop the guest, put the network back with `deploy/tap.sh down`, and delete `work/`. `work/` also holds the private SSH key for the guest.

If you tried it on EC2, empty the bucket and then destroy the stack, because a bucket that is not empty cannot be deleted.

```bash
vp run firecracker:kit:empty
vp run firecracker:infra:destroy
```

The instance and its root volume go with the stack. The launch template sets the root volume to be deleted when the instance is terminated. The kernel, the root file system and any snapshot files made on the instance go with the volume. What remains is the chapter 11 network, which `vp run net:infra:destroy` removes if no other chapter uses it. Confirm in the EC2 console that no instance and no volume are left.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (that the committed JSON is cut from the specification of the pinned release; that every request that can be sent fits an operation, `operationId`, success status and body definition of the specification; that the schema's vCPU range, the state enumeration and the required fields equal the specification's; validation of the configuration; the order of requests; a boot over a Unix domain socket; that `InstanceStart` is not sent when the configuration is refused part-way; sending the configuration again; that a configuration change after the boot is refused; the lost answer to `InstanceStart`; the precondition of a snapshot; how boot time is measured; the assertions on the stack). The type check. `firecracker:plan`, `firecracker:kit:build`, `firecracker:spec`, `firecracker:infra:synth`. Starting the bundled `guest-server.mjs` on macOS and getting 200 from `/health`. That `firecracker:boot` ends on macOS without sending anything. Run on October 13, 2026 with Node.js 24.21.0.

**Not checked yet.** Firecracker was never started. The machine this chapter was written on runs macOS and has no KVM. So none of the following is confirmed: that this client talks to the real Firecracker v1.17.0; that the real server refuses what this book's server refuses; that `deploy/prepare.sh` and `deploy/tap.sh` work; that the official Node.js binary runs in the root file system of Firecracker's CI; that the chapter 04 server answers inside a guest; boot times; snapshots.

Nothing was run against AWS either. Deploying the stack, `/dev/kvm` appearing on a c7i.large with nested virtualization enabled, Firecracker running on it, cdkd creating the launch template and the instance through the Cloud Control API, a guest being unable to obtain a metadata token with a hop limit of 1, and the cleanup are all unconfirmed.

What could not be confirmed from a primary source. The whitepaper "Security Overview of AWS Fargate" could not be read: its host answered 403. What this chapter says about Fargate and Firecracker is limited to AWS's blog of 2018 and today's ECS guide. The HTML pages of the Lambda whitepaper redirected to the developer guide, so the PDF was read. Its last revision is from December 2022, and its SnapStart paragraph is older than the guide. Firecracker's quickstart, which says EC2 supports KVM only on `.metal`, disagrees with the nested virtualization page of the EC2 guide. The announcement of Lambda MicroVMs was read through a fetcher that returns a summary.

**How to check.** On a machine with Linux and KVM, put the output of `vp run firecracker:kit:build` in place and follow the [Run It Locally](/en/chapters/67-firecracker/local.md) page step by step. First see that `curl --unix-socket /tmp/firecracker.socket http://localhost/version` returns the version, then run `boot.mjs`. For every refused request, compare the status and `fault_message` with the rules in `test/support/fake-firecracker.ts`, and correct this book's server where they differ. To check on EC2, create the instance by the steps of the [Deploy](/en/chapters/67-firecracker/deploy.md) page and record from the output of `ls -l /dev/kvm` onward.

**Not used.** The jailer (a shortcut that follows the quickstart; use it in production). `.metal` instances (more than USD 5 an hour; they are what Firecracker tests on). Graviton instances (not on the nested virtualization list; Firecracker supports aarch64). Code generation from the specification (no dependency was added; the nine used operations are written by hand and checked). Higher-level tools such as firecracker-containerd and Kata Containers (outside the chapter's scope). Lambda MicroVMs (named and placed only; prices and limits were not looked into).

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| The API socket and the order of a boot | `examples/67-firecracker/src/spec.ts`, `src/subset.ts`, `spec/firecracker-v1.17.0.subset.json`, `scripts/spec.ts`, `test/spec.test.ts` | `firecracker:spec`, `test:unit` |
| Validating the configuration | `examples/67-firecracker/src/config.ts`, `src/requests.ts`, `test/config.test.ts` | `firecracker:plan`, `test:unit` |
| The client, and a lost answer | `examples/67-firecracker/src/client.ts`, `test/client.test.ts`, `test/support/fake-firecracker.ts` | `test:unit` |
| The tests, and printing what would be sent | `examples/67-firecracker/scripts/plan.ts`, `src/args.ts` | `firecracker:plan` |
| The steps on a machine with Linux and KVM | `examples/67-firecracker/deploy/`, `src/guest-server.ts`, `src/boot.ts`, `scripts/boot.ts`, `scripts/build.ts`, `test/boot.test.ts` | `firecracker:kit:build`, `firecracker:boot` |
| An instance as a place to try it | `examples/67-firecracker/infra/`, `src/host-config.ts`, `scripts/kit.ts` | `firecracker:infra:synth`, `firecracker:infra:deploy`, `firecracker:kit:publish`, `firecracker:kit:empty`, `firecracker:infra:destroy` |

**Primary sources** (all checked on 2026-10-13)

- The Firecracker v1.17.0 repository: [README](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/README.md), [SPECIFICATION](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/SPECIFICATION.md), [Design](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/design.md), [FAQ](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/FAQ.md), [Charter](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/CHARTER.md), [LICENSE](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/LICENSE), [Getting Started](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/getting-started.md), [Dev machine setup](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/dev-machine-setup.md), [Jailer](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/jailer.md), [Production host setup](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/prod-host-setup.md), [Snapshotting](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/snapshotting/snapshot-support.md), [Kernel policy](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/kernel-policy.md), [Actions API](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/docs/api_requests/actions.md), [API specification](https://raw.githubusercontent.com/firecracker-microvm/firecracker/v1.17.0/src/firecracker/swagger/firecracker.yaml), [CI root file system script](https://github.com/firecracker-microvm/firecracker/blob/v1.17.0/resources/rootfs/setup-ubuntu-ci.sh), [the v1.17.0 release](https://github.com/firecracker-microvm/firecracker/releases/tag/v1.17.0)
- The paper: [Firecracker: Lightweight Virtualization for Serverless Applications](https://www.usenix.org/system/files/nsdi20-paper-agache.pdf) (NSDI '20; about Firecracker v0.20.0 and the Lambda of that time)
- AWS, Lambda: [Security Overview of AWS Lambda](https://docs.aws.amazon.com/pdfs/whitepapers/latest/security-overview-aws-lambda/security-overview-aws-lambda.pdf), [Understanding the Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html), [Lambda SnapStart](https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html), [Lambda Managed Instances](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances.html), [Security for Lambda Managed Instances](https://docs.aws.amazon.com/lambda/latest/dg/lambda-managed-instances-security.html), [AWS Lambda MicroVMs](https://docs.aws.amazon.com/lambda/latest/dg/lambda-microvms-guide.html), [AWS introduces Lambda MicroVMs](https://aws.amazon.com/about-aws/whats-new/2026/06/aws-lambda-microvms/)
- AWS, Fargate and others: [Amazon ECS security considerations for when to use Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-fargate-ec2.html), [Amazon ECS task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html), [Serverless and Containers - Logical Separation on AWS](https://docs.aws.amazon.com/whitepapers/latest/logical-separation/serverless-and-containers.html), [Firecracker - Lightweight Virtualization for Serverless Computing](https://aws.amazon.com/blogs/aws/firecracker-lightweight-virtualization-for-serverless-computing/), [Announcing the Firecracker Open Source Technology](https://aws.amazon.com/blogs/opensource/firecracker-open-source-secure-fast-microvm-serverless/)
- EC2: [Use nested virtualization to run hypervisors in Amazon EC2 instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/amazon-ec2-nested-virtualization.html), [AWS::EC2::LaunchTemplate CpuOptions](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-ec2-launchtemplate-cpuoptions.html), [AWS Price List: Amazon EC2, ap-northeast-1](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.csv)
- Others: [How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/), [Workers security model](https://developers.cloudflare.com/workers/reference/security-model/), [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox), [Node.js v24.21.0 SHASUMS256.txt](https://nodejs.org/dist/v24.21.0/SHASUMS256.txt)

:::
