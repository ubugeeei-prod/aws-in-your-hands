---
title: "67 Firecracker: Deploy"
---

# 67 Firecracker: Deploy

This stack gives a place on EC2 to try Firecracker, for readers with no machine running Linux and KVM. **Deployed with `-c run=true`, it starts one c7i.large, which is billed every hour until you destroy it.** At the On-Demand list price in the Tokyo Region that is USD 0.11235 an hour. With the public IPv4 address and the root volume, two hours come to USD 0.24, and a month of forgetting it to USD 87.20. Without the flag no instance is created and nothing is billed by the hour. Apart from the synth, no command on this page was run.

## An instance as a place to try it

<!-- section: 67.host -->

Firecracker's quickstart says it uses only `.metal` instance types on EC2, because EC2 supports KVM only on `.metal`. The c5.metal it names costs USD 5.136 an hour in the Tokyo Region, USD 10.27 for two hours.

The EC2 user guide, however, has a page on nested virtualization. It runs KVM or Hyper-V inside ordinary instances that are not bare metal, at no additional cost. As of October 13, 2026 it is supported on some Intel families, among them M7i, C7i, C8i and R8i, and no Graviton family is on the list. It is enabled with the CPU option `NestedVirtualization` when the instance is launched.

The two statements disagree, and the quickstart reads as the older one. This stack uses the cheaper nested virtualization. Use it knowing the following.

- The Firecracker project tests only `.metal` instances. Neither its material nor this book has a record of Firecracker running under nested virtualization
- The EC2 guide advises evaluating bare metal for workloads that are sensitive to performance or latency. A time measured here is the time of a virtual machine inside a virtual machine
- It is a setup for practice. There is no jailer and SMT is not disabled. It is not a place to run anyone else's code

There are three settings.

<<< @/examples/67-firecracker/src/host-config.ts{schema}

<<< @/examples/67-firecracker/infra/bin/app.ts{context}

Nested virtualization goes into a launch template. In the CDK version this book pins, the CPU options of `AWS::EC2::Instance` do not have the property, and the launch template's do.

<<< @/examples/67-firecracker/infra/lib/firecracker-host-stack.ts{launch-template}

The image is Amazon Linux 2023 for x86_64 with the 6.1 kernel, one of the host kernels Firecracker v1.17.0 supports. The metadata settings are those of chapter 23: the token's answer travels one hop at most. The guest is behind the TAP device, so it should not be able to obtain a token, but that is reasoning from the setting and was not checked. The `tap.sh` of the previous page also drops packets to the metadata address on the host.

The instance itself is created only with the flag.

<<< @/examples/67-firecracker/infra/lib/firecracker-host-stack.ts{instance}

It goes into a public subnet of the chapter 11 VPC. It downloads the Firecracker binary, the kernel and Node.js from GitHub, S3 and nodejs.org, so it needs HTTPS out. No inbound traffic is allowed at all. The way in is Session Manager, as in chapter 23.

<<< @/examples/67-firecracker/infra/lib/firecracker-host-stack.ts{network}

The instance has no checkout of this repository, so the `dist/kit/` built on the previous page reaches it through an S3 bucket. The one permission added to the role is reading that prefix.

<<< @/examples/67-firecracker/infra/lib/firecracker-host-stack.ts{kit}

How the pinned cdkd (0.296.28) treats these was checked too. `AWS::EC2::LaunchTemplate` has no implementation of its own and goes through the Cloud Control API. `AWS::EC2::Instance` has one, but `LaunchTemplate` is not in the list of properties that implementation writes itself. If chapter 23 read cdkd correctly, this instance goes through the Cloud Control API as well. Neither was confirmed by deploying. The remaining types (security group, role, policy, instance profile, bucket, bucket policy) are ones the chapter 23 stack uses too.

The steps are these. The chapter 11 network comes first.

```bash
vp run net:infra:deploy
vp run firecracker:infra:deploy -c run=true
vp run firecracker:kit:publish
```

`firecracker:kit:publish` packs `dist/kit/` into one archive, puts it in the bucket, and prints the command to run on the instance. Enter the instance through Session Manager in the management console, or with the AWS CLI and the Session Manager plugin. The instance ID is the stack output `InstanceId`.

```bash
aws ssm start-session --target <InstanceId> --region ap-northeast-1
```

On the instance, first check that KVM is visible, then install the tools and unpack the kit.

```bash
ls -l /dev/kvm
sudo dnf install -y squashfs-tools iptables-nft jq tar xz openssh-clients
mkdir kit && cd kit
aws s3 cp s3://<KitBucketName>/kit/kit.tgz . && tar -xzf kit.tgz
```

If there is no `/dev/kvm`, nested virtualization is not enabled. From there on the steps are those of the [Run It Locally](/en/chapters/67-firecracker/local.md) page, starting at `bash deploy/prepare.sh`. The package names are Amazon Linux 2023's, and whether this list is enough was not confirmed by running it either.

When you are done, destroy it the same day. The steps are on the [next page](/en/chapters/67-firecracker/wrap.md).
