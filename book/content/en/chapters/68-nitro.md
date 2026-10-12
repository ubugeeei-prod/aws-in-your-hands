---
title: "68 Nitro: What EC2 Stands On, Nitro Enclaves, and Graviton"
sourceRevision: 1
---

# 68 Nitro: What EC2 Stands On, Nitro Enclaves, and Graviton

[Chapter 23](/en/chapters/23-ec2.md) kept one server. This chapter looks at what that instance stands on: the AWS Nitro System. It shares nothing but a name with the Nitro that appeared in [chapter 09](/en/chapters/09-ssr.md) as Nuxt's server engine.

What the Nitro System did fits in one sentence. Of the work of virtualization, it moved network and storage I/O off the host's CPU onto dedicated cards, and left the hypervisor on the host with one job, dividing CPU and memory. That a data volume's device name can change from one boot to the next, how instance types are named, that bare metal instances exist, and that you can carve out a place for computation that even the instance's administrator cannot read: each of these follows from that design.

This chapter's stack **is billed by the hour for as long as it exists**. The default layout adds about USD 2.23 a day, or USD 67.91 for a month of 730 hours, on top of chapter 11. Stopping the instance brings that down to USD 1.77 a month, and destroying the stack brings it to zero. The steps are under [cleanup](/en/chapters/68-nitro/wrap.md).

Much of this chapter is about places you cannot touch. So it keeps three things apart: what AWS's material states, what follows from it, and what nobody outside AWS can confirm. The material is the documentation of EC2, Nitro Enclaves, and KMS, and the whitepaper AWS publishes, "The Security Design of the AWS Nitro System" (published November 2022, updated February 2024).

Nothing was run against AWS. No enclave image was built and no enclave was started: the machine this book is written on runs macOS and has no Docker. What was checked locally is the reading of names, the key policy and its evaluation, and a model of the exchange between a parent instance, an enclave, and KMS. The code is in `examples/68-nitro/`.

## What it costs just to exist

<!-- section: 68.cost -->

Amounts are in USD, at the on-demand list price for the Tokyo Region, before tax. A month is 730 hours. The chapter 11 network is not included.

| State | One day | One month |
| --- | --- | --- |
| Left running | 2.23 | 67.91 |
| Left stopped | 0.06 | 1.77 |

The parts are these.

- The instance: a `c6g.large` at USD 0.0856 an hour, 62.49 for 730 hours. Not billed while stopped
- The public IPv4 address: USD 0.005 an hour, 3.65 for 730 hours. It is auto-assigned, so it is released when the instance stops
- The root volume: gp3 at USD 0.096 per GB-month. The AMI decides its size; assuming 8 GiB as chapter 23 does, 0.77. Billed while stopped too
- The KMS key: USD 1 a month per key, prorated by the hour (the pricing page as chapter 21 read it). Billed even if it is never used

An enclave costs nothing. The documentation says there are no additional charges for Nitro Enclaves, only those for the instance and for the other services used with it. An enclave uses part of the vCPUs and memory the instance already pays for.

Some things are not in the table: KMS requests (USD 0.03 per 10,000), data transfer, and the chapter 11 VPC. No Free Tier allowance is deducted, because whether one applies could not be confirmed. With `-c instanceType=m6g.large` the figures become USD 2.55 a day and USD 77.69 a month.

What is billed, and when, is written as code.

<<< @/examples/68-nitro/src/cost.ts{billable}

You can print the amounts locally, without an AWS account.

```bash
vp run nitro:prices
vp run nitro:prices instanceType=m6g.large
```

## The parts of the Nitro System

<!-- section: 68.system -->

The whitepaper describes the Nitro System as three components.

```figure
caption: Nitro Cards take over I/O, and the hypervisor left on the host's board only divides CPU and memory
node cp: EC2 control plane
node ctrl: Nitro Controller | Nitro Card, root of trust
node hv: Nitro Hypervisor | CPU and memory only
node chip: Nitro Security Chip | guards firmware
node guest: EC2 instance | your OS and code
node vpc: Nitro Card for VPC | network
node ebsc: Nitro Card for EBS | volumes
edge cp -> ctrl: authenticated API
edge ctrl -> hv: start, stop
edge ctrl -> chip
edge hv -> guest: vCPUs, memory
edge guest -> vpc: ENA
edge guest -> ebsc: NVMe
group board: system main board = hv, chip, guest
mark hv
```

**Nitro Cards.** Hardware designed by AWS, separate from the main board. Everything an instance sees as a network, and as EBS or instance store storage, is provided here. So is the point where instructions from the EC2 control plane arrive; the card with that role is called the Nitro Controller. The cards present storage as NVMe devices and the network as ENA (Elastic Network Adapter) devices, over PCIe.

**The Nitro Security Chip.** A part on the main board that mediates every write to firmware. At boot it holds the CPUs in reset until the Nitro Controller has finished checking the board's firmware.

**The Nitro Hypervisor.** Software that runs on the host's CPU. It takes start and stop commands from the Nitro Controller, divides CPU and memory using the processor's virtualization features, and assigns the devices the cards provide to instances. According to the whitepaper it has no networking stack, no general-purpose file system, no peripheral device drivers, no shell, and no interactive way in. The whitepaper also says it is based on KVM.

Before the Nitro System, EC2 used Xen. The host had a special virtual machine called dom0, and the Amazon Linux inside it emulated devices and managed the host. The whitepaper says the Nitro System moved that work to cards piece by piece and eliminated dom0 with C5 in 2017. Every instance type released since the beginning of 2018 stands on the Nitro System. The `t4g.micro` of chapter 23 is one of them.

That is as far as the material goes. The software inside the cards, how many cards there are and how generations differ, and the hypervisor's source code are not published. The documentation does give version numbers, "Nitro v2" to "Nitro v6", for each instance family, but what it lists per version is only the difference in network features.

## Where you can see it

<!-- section: 68.claims -->

For someone using an instance, this design shows up in four ways.

**Volumes appear as NVMe, the network as ENA.** The documentation says that on Nitro System instances EBS volumes appear as NVMe block devices and that the network uses ENA. What follows is that the device name the OS sees is decided by the NVMe driver, not by the `/dev/sdf` you gave when attaching the volume. That concerns chapter 23's data volume, so it is covered on [the next page](/en/chapters/68-nitro/build.md).

**Nearly all of the host's resources reach the instance.** AWS's product page says the Nitro System delivers "practically all" of the host's compute and memory resources to instances. The reasoning holds: management software that does not run on the host's CPU leaves that CPU free. No figure for how much remains is in the material, and there is no way to measure it from outside.

**It can run without a hypervisor.** Because the cards take the I/O and the Security Chip guards the firmware, a whole board can be rented out with no hypervisor on it. That is a bare metal instance, one whose size is `metal`. As a use, the documentation names workloads that need hardware features (Intel VT, for example) that are not available in a virtualized environment. Running microVMs of your own is the subject of [chapter 67](/en/chapters/67-firecracker.md).

**EBS optimization is the default.** EBS optimization, which gives traffic to EBS a dedicated share of bandwidth, was a feature you enabled for an hourly fee on older generations. In the documentation's list, `t4g.micro` and `c6g.large` are both on the side where it is on by default. It has stopped being a setting.

One more claim is not visible at all. The whitepaper says there is no mechanism for any system or person to log in to a Nitro System host, to access the memory of instances, or to access the contents of encrypted instance storage and encrypted EBS volumes. Maintenance, it says, goes through a limited set of authenticated, authorized, and logged APIs, none of which reaches customer data. It also names the price: some faults cannot be examined in place and have to be reproduced on separate hardware.

This is AWS's claim. AWS asked NCC Group to assess the design and announced in a blog post of May 2023 that the report affirmed the claims. The sentence the post quotes says, in substance, that as a matter of design no gaps were found that would compromise AWS's security claims. The report itself was not read for this chapter.

What you can conclude from this is limited: that AWS has committed in writing to this design, and that AWS has announced a third party's assessment of the design. Whether the actual hosts are built and operated as designed cannot be confirmed by anyone outside AWS. If the design is as described, there is no way to examine the host from inside an instance.

## What this chapter builds

<!-- section: 68.when-not -->

Nothing so far is something you build. What you can build is the part that uses a mechanism the Nitro System lends you: Nitro Enclaves.

An enclave is another virtual machine, carved out of part of an instance's vCPUs and memory. It has no network, no persistent storage, and no way to log in. All it has is one socket to the instance it came from, the parent instance. The documentation says that neither the processes of the parent instance nor its root user can access the data and applications inside the enclave.

This chapter adds one design to the notes app. **The key that encrypts a note is in plaintext only inside the enclave.** The parent instance holds each note's ciphertext and a data key wrapped by a KMS key. Only the enclave can unwrap it, and the KMS key policy is what decides that.

The stack creates three things: an instance with enclaves enabled, a KMS key, and a role.

<<< @/examples/68-nitro/src/config.ts{schema}

`measurement` has no default on purpose. Until you build an enclave image, the value does not exist. Deploy without it and you get a key nobody can use.

First, when not to use this. Most of this book's app has no need for an enclave. Lambda and Fargate offer no place to create one. The chapter 23 instance is a `t4g.micro`, which is not supported either. If all you want is notes encrypted at rest, the encryption of DynamoDB, S3, and EBS is enough ([chapter 21](/en/chapters/21-security.md)). If all you want is to limit who may use a key, a key policy and IAM are enough.

An enclave is the answer when keys or personal data must be hidden even from people who can enter the instance and from other software running on it: a payment secret, a signing key, identity documents. In exchange you keep an instance billed by the hour, rewrite a key policy every time the image is rebuilt, and operate something whose console you cannot even read outside debug mode. There is also a good deal it does not do, collected under [costs, pitfalls, and cleanup](/en/chapters/68-nitro/wrap.md).
