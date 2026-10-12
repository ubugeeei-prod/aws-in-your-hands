---
title: "68 Nitro: Costs, Pitfalls, and Cleanup"
---

# 68 Nitro: Costs, Pitfalls, and Cleanup

The last page of the chapter. It goes through what an enclave does not solve, how this differs on a platform without servers, where people stumble, what to change for production, and the cleanup. The costs are on [the first page](/en/chapters/68-nitro.md).

## What an enclave does not solve

<!-- section: 68.limits -->

An enclave promises that the parent cannot touch the memory and vCPUs carved out for it, and that it can prove to the outside which image it was booted from. What lies outside those two is not protected.

**A mistake in the enclave's own code.** Attestation proves which code is running. It does not prove that the code is right. The tests include an image that puts the data key into its response. Write that image's measurement into the policy and KMS hands over the key, and the key reaches the parent. No part of the mechanism is broken. Whether the person who writes a measurement into the policy has read what is in that image is the last line of defense. This is the reason to keep the code inside an enclave small.

**Whoever can rewrite the key policy.** Anyone with `kms:PutKeyPolicy` can remove the condition. The user guide says the parent instance administrator should have neither permission to use the key nor permission to change the key policy. An enclave hides data from the instance's administrator. It does not hide it from the key's administrator. Giving the two roles to different people, and watching key policy changes in CloudTrail (chapter 21), is part of the mechanism.

**An allow without the condition.** If the key policy has even one unconditional `kms:Decrypt`, or if the account is given `kms:*` and an IAM policy allows `Decrypt`, there is a way around the enclave. The tests show the parent obtaining a key under a policy written without the condition. The stack tests pin that the synthesized template contains no `kms:*` and that the role has no IAM policy.

**Data that passes through the parent.** As the section on [sealing a note](/en/chapters/68-nitro/more.md) says, the note's text passes through the parent. The parent is free to compose requests to the enclave, so it can ask a running enclave to open notes. For the enclave to refuse, the enclave itself has to verify who is asking.

**Being stopped.** The parent can terminate the enclave, and can decline to deliver messages. An enclave protects confidentiality, not availability. It has no persistent storage, so its state starts empty at every boot.

**Side channels.** The whitepaper says an enclave inherits the same isolation and side-channel mitigations as any other instance, and shares neither cores nor memory with its parent. What follows is that the kind of attack that presupposes a shared core does not, by design, apply between a parent and its enclave. The mitigations themselves cannot be confirmed from outside. The time an enclave takes to answer, on the other hand, is in full view of the parent. The kind of problem the whitepaper uses as its example, a secret leaking through the time a comparison takes, is for the code you put in the enclave to prevent.

## On a platform without servers

<!-- section: 68.platforms -->

Everything in this chapter comes up because you choose the server yourself. Cloudflare Workers code runs in V8 isolates on the machines of Cloudflare's network, and no virtual machine is created per function, according to its documentation (as of 2026-10-13). Instance types, processor architecture, and device names of volumes do not appear as things the developer decides. Whether Workers has a mechanism that corresponds to an enclave was not checked. Nothing was checked for Vercel either.

Lambda and Fargate sit in between. You choose an architecture, and you do not choose an instance type. What runs underneath them is in [chapter 67](/en/chapters/67-firecracker.md).

If a platform where you neither read names nor look for devices is enough, there is less to learn there. The knowledge in this chapter is needed once you have decided to keep a server, as chapter 23 did.

## Where people stumble

**Trying to use a T type as the parent.** Neither `t4g` nor `t3` is supported by Nitro Enclaves. This chapter's settings accept two types and no others.

**Waiting for a key in debug mode.** The PCRs of an enclave started with `--debug-mode` are zero. It gets no key. The user guide's tutorial tells you to write an all-zero value into the policy when in debug mode. That means "hand the key to any image, in debug mode", so this chapter's settings refuse an all-zero value.

**Rebuilding the image.** Bumping one dependency changes PCR0. A policy still holding the old value turns the new enclave away.

**Deploying again without `-c measurement=`.** The second statement disappears from the policy. No error is raised, and the enclave stops getting keys.

**The allocator setting.** On a Graviton instance with 2 vCPUs, 1 vCPU is set aside. Left at the default of 2, it does not match what the user guide says. What happens then was not checked.

**Stopping the parent.** An enclave ends when its parent stops. Whether it comes back on its own after the parent is started again was not checked.

**Writing `/dev/nvme1n1`.** On the next boot that name may point at another volume.

**Bringing an image built for x86.** An enclave is a virtual machine on the same processor as its parent, so the image presumably has to be built for the parent's architecture. The user guide's vsock tutorial also has you look up the OS's architecture and build for it. What happens when an image of another architecture is given was not checked.

## For production

- **Put it in a private subnet.** Provide interface endpoints for KMS and Systems Manager, and pull base images from ECR (chapter 11, [chapter 52](/en/chapters/52-ecr.md))
- **Sign the image and use PCR8 and PCR3 in the condition.** A condition on PCR0 alone has to be rewritten at every build. The user guide recommends combining the signing certificate (PCR8) with the parent's role (PCR3). Decide beforehand, too, whether a replacement needs keys handed to both the old and the new enclave while it is under way
- **Separate the key's administrator from the instance's administrator.** If the person who can change the key policy is the person who can enter the instance, the enclave is worth much less
- **Have a procedure for approving a measurement.** Who reads the image's source, and who puts PCR0 into the policy. Build the image in CI, and make it possible to check that the same source gives the same PCR0
- **Verify the user inside the enclave.** Only with token verification and the encryption toward the user moved inside is the text hidden from someone who got into the parent
- **Set the key not to be deleted.** The practice stack deletes the key after a seven-day wait. In production use `RemovalPolicy.RETAIN` and turn rotation on (chapter 21)
- **Watch attested requests.** KMS leaves the document's information in `additionalEventData` in CloudTrail. A record of a refused `Decrypt` may be the trace of someone trying without a document

## Cleanup

<!-- section: 68.cleanup -->

These steps were not run either. Terminate the enclave, then destroy the stack. The first line is run on the instance, the second on your machine.

```bash
nitro-cli terminate-enclave --all
vp run nitro:infra:destroy
```

The first line can be skipped: when the parent is terminated, its enclaves end. The second should delete the instance, the security group, and the role, and leave the key pending deletion.

The key does not disappear at once. It stays pending deletion for seven days, unusable. After seven days it is gone, and the data keys it wrapped can never be opened again. If you want to keep anything sealed by this chapter's steps, open it in the enclave before destroying. Whether a key is billed while pending deletion could not be confirmed, as in chapter 21.

Check for yourself that things are gone.

```bash
aws ec2 describe-instances --region ap-northeast-1 --filters Name=instance-state-name,Values=pending,running,stopping,stopped
aws kms describe-key --region ap-northeast-1 --key-id <KeyId>
```

Look for this chapter's instance to be absent from the first, and for a `KeyState` of `PendingDeletion` in the second.

What remains, besides the key pending deletion, is the storage created by cdkd's bootstrap (chapter 02) and the chapter 11 network. Clean up chapter 11 by its own steps.

::: details Verification notes for this chapter

**Checked locally.** Unit tests (reading instance type names, finding a device from a volume ID, PCR3 and PCR4 matching the example values in the user guide, the key policy and its evaluator, the model of parent, enclave, and KMS with its invariant, pricing inputs, stack assertions). Type check. `nitro:infra:synth` (default, `-c measurement=<96 digits>`, `-c instanceType=m6g.large`). `nitro:demo`, `nitro:names`, `nitro:prices`. The arguments of `aws ec2 describe-instances`, `aws kms decrypt`, `aws kms describe-key`, `aws ssm start-session`, and `aws ec2 modify-instance-metadata-options` were read in the help of the devShell's AWS CLI 2.35.11. The `KeyState` value was read in the type definitions of `@aws-sdk/client-kms` 3.1149.0. The amounts in the text are computed by `tools/src/pricing/calc.ts` from Price List unit prices, and `examples/68-nitro/test/pricing.test.ts` compares them with the numbers in the text.

**Not checked yet.** Nothing was run against AWS. That covers every one of `nitro:infra:diff`, `nitro:infra:deploy`, `nitro:infra:drift`, and `nitro:infra:destroy`. No enclave image was built and no enclave was ever started: the machine this book is written on runs macOS, with neither Docker nor Linux. All of the following therefore waits for the real thing. That cdkd 0.296.28 can create and delete this stack, and in particular that `EnclaveOptions` gets through Cloud Control API and enclaves end up enabled. That KMS accepts this chapter's key policy, and that the listed administrative actions are enough for cdkd to create and delete the key. That the hello sample runs on a 2-vCPU Graviton instance with the allocator set to 1 vCPU, and starts with `--cpu-count 1`. That the default root volume holds the Docker images and the image file. That `Decrypt` and `GenerateDataKey` succeed from inside the enclave and the same calls from the parent are refused. Whether the user guide's parent container can read credentials with a hop limit of 1. That the output of `kmstool_enclave_cli genkey` can be passed to `decrypt` as it is. That the real output of `lsblk --json` has the shape of the test input. The resume steps are in the validation record on the reference page.

What this chapter does not contain. There is no part that turns the TypeScript code that seals notes (`src/enclave/vault.ts`) into an enclave image. It would need a vsock listener, a document from the hypervisor, and a KMS call carrying the document. It has run only on the model.

What could not be confirmed from primary sources. The insides of the Nitro Cards and the hypervisor are not published; only the whitepaper and the product pages were read. The NCC Group report itself was not read, and the text goes no further than what AWS's blog quotes. No figure showing that "nearly all of the host's resources reach the instance" is in the material. The naming conventions page gives neither the order of option letters nor the meaning of a name without a processor letter. Which Graviton generation Fargate's arm64 runs on is not in the ECS documentation. The time the same work takes on arm64 and on x86 was not measured. The names of the errors KMS actually returns, and the format inside `CiphertextForRecipient`, are not in the model. The KMS pricing page was not re-read today; the text relies on what chapter 21 confirmed on 2026-10-12 (a key is USD 1 a month prorated by the hour, and 20,000 requests a month are free). The root volume size of the Amazon Linux 2023 AMI, the util-linux version it ships, and the user name of a Session Manager session were not checked. For opening a vsock from Node.js, only the absence of the word in the `net` module's documentation was observed; other ways were not investigated. For Cloudflare one page was read, and nothing was checked for Vercel.

Resource types cdkd handles. Reading the installed cdkd 0.296.28, dedicated providers are registered for `AWS::EC2::Instance`, `AWS::EC2::SecurityGroup`, `AWS::IAM::InstanceProfile`, `AWS::IAM::Role`, and `AWS::KMS::Key`. The provider for EC2 instances, however, marks `EnclaveOptions` as "not yet implemented by cdkd", and an instance whose template sets this property is routed through Cloud Control API. The code also says that stopping this detour with `--prefer-sdk-route` drops the property silently. The stack tests pin the list of types in use.

**Where the code is.**

| Section | Files | Tasks |
| --- | --- | --- |
| What it costs just to exist | `examples/68-nitro/src/cost.ts`, `scripts/prices.ts`, `test/pricing.test.ts`, `data/pricing/` | `nitro:prices`, `test:unit` |
| What this chapter builds | `examples/68-nitro/src/config.ts` | `test:unit` |
| A device name can change from one boot to the next | `examples/68-nitro/src/volume.ts`, `test/volume.test.ts`, `test/fixtures/lsblk.ts`, `examples/23-ec2/deploy/notes-data-volume.sh` | `test:unit` |
| Reading an instance type name | `examples/68-nitro/src/instance-type.ts`, `scripts/names.ts`, `test/instance-type.test.ts` | `nitro:names`, `test:unit` |
| Graviton | `examples/68-nitro/src/arch.ts`, `scripts/prices.ts`, `test/pricing.test.ts`, `data/pricing/` | `nitro:prices`, `test:unit` |
| An enclave and its measurements | `examples/68-nitro/src/measurement.ts`, `test/measurement.test.ts` | `test:unit` |
| KMS decides who receives the key | `examples/68-nitro/src/policy.ts`, `test/policy.test.ts` | `test:unit` |
| Sealing a note | `examples/68-nitro/src/enclave/vault.ts`, `src/enclave/protocol.ts`, `test/enclave.test.ts` | `test:unit` |
| The stack | `examples/68-nitro/infra/lib/nitro-stack.ts`, `infra/bin/app.ts`, `infra/test/nitro-stack.test.ts` | `nitro:infra:synth`, `test:unit` |
| Run it locally | `examples/68-nitro/src/enclave/model.ts`, `src/enclave/attestation.ts`, `src/enclave/kms-model.ts`, `scripts/demo.ts`, `test/enclave.test.ts` | `nitro:demo`, `test:unit`, `nitro:infra:synth` |
| Deploying | `examples/68-nitro/infra/bin/app.ts`, `tools/src/infra/` | `nitro:infra:diff`, `nitro:infra:deploy`, `nitro:infra:drift` |
| Getting an enclave started | `examples/68-nitro/infra/lib/nitro-stack.ts`, `src/measurement.ts` | `nitro:infra:deploy` |
| What an enclave does not solve | `examples/68-nitro/test/enclave.test.ts`, `src/enclave/model.ts` | `test:unit` |
| Cleanup | `examples/68-nitro/infra/lib/nitro-stack.ts` | `nitro:infra:destroy` |

**Primary sources** (all checked on 2026-10-13)

- The Nitro System: [Instances built on the AWS Nitro System](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-nitro-instances.html), [AWS Nitro System](https://aws.amazon.com/ec2/nitro/), the whitepaper The Security Design of the AWS Nitro System: [Introduction](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/security-design-of-aws-nitro-system.html), [Traditional virtualization primer](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/traditional-virtualization-primer.html), [The Nitro System journey](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/the-nitro-system-journey.html), [The components of the Nitro System](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/the-components-of-the-nitro-system.html), [Putting the pieces together: EBS volume attachment](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/putting-the-pieces-together-ebs-volume-attachment.html), [No AWS operator access](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/no-aws-operator-access.html), [The EC2 approach to preventing side-channels](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/the-ec2-approach-to-preventing-side-channels.html), [Conclusion](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/conclusion.html), and the AWS blog post [AWS Nitro System gets independent affirmation of its confidential compute capabilities](https://aws.amazon.com/blogs/compute/aws-nitro-system-gets-independent-affirmation-of-its-confidential-compute-capabilities/)
- Instance types and devices: [Amazon EC2 instance type naming conventions](https://docs.aws.amazon.com/ec2/latest/instancetypes/instance-type-names.html), the specification tables ([general purpose](https://docs.aws.amazon.com/ec2/latest/instancetypes/gp.html), [compute optimized](https://docs.aws.amazon.com/ec2/latest/instancetypes/co.html)), [Amazon EBS volumes and NVMe](https://docs.aws.amazon.com/ebs/latest/userguide/nvme-ebs-volumes.html), [Map Amazon EBS volumes to NVMe device names](https://docs.aws.amazon.com/ebs/latest/userguide/identify-nvme-ebs-device.html), [Device names for volumes](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/device_naming.html), [Amazon EBS-optimized instance types](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ebs-optimized.html), [Enhanced networking with ENA](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/enhanced-networking-ena.html), [lsblk(8)](https://man7.org/linux/man-pages/man8/lsblk.8.html), [lsblk.c](https://github.com/util-linux/util-linux/blob/v2.40.2/misc-utils/lsblk.c) of util-linux 2.40.2
- Graviton: [AWS Graviton Processors](https://aws.amazon.com/ec2/graviton/), [Lambda's instruction set architecture](https://docs.aws.amazon.com/lambda/latest/dg/foundation-arch.html), [Amazon ECS task definitions for 64-bit ARM workloads](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-arm64.html)
- The Nitro Enclaves user guide: [What is Nitro Enclaves?](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave.html), [Concepts](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave-concepts.html), [Enclave workflow overview](https://docs.aws.amazon.com/enclaves/latest/user/flow.html), [Building an enclave image file](https://docs.aws.amazon.com/enclaves/latest/user/building-eif.html), [Creating an enclave](https://docs.aws.amazon.com/enclaves/latest/user/create-enclave.html), [Hello Enclaves](https://docs.aws.amazon.com/enclaves/latest/user/getting-started.html), [Connect the parent instance with an enclave by using virtio-vsock](https://docs.aws.amazon.com/enclaves/latest/user/enclave-networking.html), [Connect an enclave with AWS KMS](https://docs.aws.amazon.com/enclaves/latest/user/connect-enclave-kms.html), [Cryptographic attestation](https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html), [Using cryptographic attestation with AWS KMS](https://docs.aws.amazon.com/enclaves/latest/user/kms.html), [Verifying the root of trust](https://docs.aws.amazon.com/enclaves/latest/user/verify-root.html), [Security](https://docs.aws.amazon.com/enclaves/latest/user/security.html), [Install the Nitro Enclaves CLI on Linux](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave-cli-install.html), [nitro-cli build-enclave](https://docs.aws.amazon.com/enclaves/latest/user/cmd-nitro-build-enclave.html), [run-enclave](https://docs.aws.amazon.com/enclaves/latest/user/cmd-nitro-run-enclave.html), [terminate-enclave](https://docs.aws.amazon.com/enclaves/latest/user/cmd-nitro-terminate-enclave.html), [AWS Nitro Enclaves FAQs](https://aws.amazon.com/ec2/nitro/nitro-enclaves/faqs/), and on GitHub [kmstool-enclave-cli](https://github.com/aws/aws-nitro-enclaves-sdk-c/blob/main/bin/kmstool-enclave-cli/README.md) and [allocator.yaml](https://github.com/aws/aws-nitro-enclaves-cli/blob/main/bootstrap/allocator.yaml)
- KMS: [Cryptographic attestation support in AWS KMS](https://docs.aws.amazon.com/kms/latest/developerguide/cryptographic-attestation.html), [Condition keys for attested platforms](https://docs.aws.amazon.com/kms/latest/developerguide/conditions-attestation.html), [Condition keys for Nitro Enclaves](https://docs.aws.amazon.com/kms/latest/developerguide/conditions-nitro-enclave.html), [How to make attested calls](https://docs.aws.amazon.com/kms/latest/developerguide/attested-calls.html), [Monitoring attested requests](https://docs.aws.amazon.com/kms/latest/developerguide/ct-attestation.html), [Decrypt](https://docs.aws.amazon.com/kms/latest/APIReference/API_Decrypt.html), [RecipientInfo](https://docs.aws.amazon.com/kms/latest/APIReference/API_RecipientInfo.html), [Default key policy](https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-default.html), [KMS key access and permissions](https://docs.aws.amazon.com/kms/latest/developerguide/control-access.html)
- CloudFormation and tools: [AWS::EC2::Instance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html), [How IMDSv2 works](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-metadata-v2-how-it-works.html), the `aws-ec2` and `aws-kms` type definitions of `aws-cdk-lib` 2.273.0, the contents of `@go-to-k/cdkd` 0.296.28, [Node.js 24's net](https://nodejs.org/docs/latest-v24.x/api/net.html)
- Pricing: the AWS Price List bulk API for [EC2](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.csv) (the CSV, filtered by usage type; published 2026-10-09). The unit prices of Lambda, Fargate, EBS, public IPv4 addresses, and KMS are the ones other chapters took from the same Price List between 2026-10-11 and 2026-10-13
- Compared with: [How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/)

:::
