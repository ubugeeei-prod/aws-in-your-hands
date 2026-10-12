---
title: "68 Nitro: Design and Build"
---

# 68 Nitro: Design and Build

[The previous page](/en/chapters/68-nitro.md) covered the parts of the Nitro System. This page takes, in order, three places where that design reaches someone using an instance: device names of volumes, instance type names, and Graviton. Nitro Enclaves are on [the next page](/en/chapters/68-nitro/more.md).

## A device name can change from one boot to the next

<!-- section: 68.devices -->

Chapter 23 attached its data volume to the instance under the name `/dev/sdf`. Yet the example run of `lsblk` in the EBS documentation shows no disk called `sdf`. It shows `nvme0n1` and `nvme1n1`.

Start with what the material states. On Nitro System instances, EBS volumes appear as NVMe block devices. According to the whitepaper, attaching a volume makes the Nitro Card for EBS provide one NVMe device, and the hypervisor sends the instance a hot-plug event. The OS's NVMe driver names devices `/dev/nvme0n1`, `/dev/nvme1n1`, and so on, in the order they respond. The EBS documentation says plainly that this order can change between starts, and that the name differs from the one given at attach time.

The `/dev/sdf` you gave is not thrown away. It is recorded in the NVMe controller's identification data, and Amazon Linux ships a udev rule that reads it and creates a symbolic link from `/dev/sdf` to the real device. That is why chapter 23's script gets away with waiting for `/dev/sdf`.

Two things follow. First, chapter 23's script depends on Amazon Linux. The documentation says other operating systems could behave differently. Switch to another distribution's AMI and `/dev/sdf` should not appear; the script would wait five minutes and fail. Second, a name like `/dev/nvme1n1` must never be written into a script. On the next boot it may point at the root volume.

The documentation recommends identifiers that do not change. After formatting there is the file system's UUID, which is why chapter 23 wrote a UUID into `/etc/fstab`. Before formatting there is the volume ID. An EBS volume reports its own volume ID as its NVMe serial number, minus the hyphen.

<<< @/examples/68-nitro/src/volume.ts{serial}

On the instance you can check with either of these. The first adds the serial column to `lsblk`; the second is a command that comes with Amazon Linux. Both are in the documentation.

```bash
lsblk -o +SERIAL
sudo ebsnvme-id /dev/nvme1n1
```

From a program, have `lsblk` print JSON and look the serial up.

<<< @/examples/68-nitro/src/volume.ts{find}

The tests put two boots of one instance side by side. In the first the root volume responds first, in the second the data volume does. `findDevice` returns the data volume in both. A script with `/dev/nvme1n1` hard-coded would format the root volume on the second boot.

The test input was written by hand from the util-linux source. It was not captured by running `lsblk` on an instance.

On the network side there is nothing for you to do. Nitro System instances use ENA for networking, and the documentation says Amazon Linux 2023 has the driver from the start. The whitepaper says the VPC network you built in chapter 11 is implemented by the Nitro Card for VPC. It does not say where on the card security groups are evaluated.

## Reading an instance type name

<!-- section: 68.names -->

Names like `t4g.micro` and `c6g.large` have a fixed order. According to the naming conventions page of the EC2 documentation, the series comes first, then the generation, then the options, and the size after the period.

- Series: what the type is for. `t` is burstable, `m` general purpose, `c` compute optimized, `r` memory optimized
- Generation: a higher number is newer
- Options: `a` is AMD, `g` is AWS Graviton, `i` is Intel processors. `d` is instance store volumes, `n` network and EBS optimized, `b` block storage optimization, `z` high CPU frequency, `flex` a Flex instance
- Size: `micro`, `large`, `4xlarge`, and so on. `metal` is bare metal

The code is that table, as it stands.

<<< @/examples/68-nitro/src/instance-type.ts{decode}

```bash
vp run nitro:names
vp run nitro:names r7iz.2xlarge
```

It prints a name part by part. Here are this chapter's `c6g.large` and the bare metal `c7gn.metal`.

```text
c6g.large
  series      c: Compute optimized
  generation  6
  processor   g: AWS Graviton processors
  size        large
  arch        arm64

c7gn.metal
  series      c: Compute optimized
  generation  7
  processor   g: AWS Graviton processors
  option      n: Network and EBS optimized
  size        metal (bare metal: no hypervisor)
  arch        arm64
```

Some things the naming page does not say. It gives no order for the option letters; that a processor letter comes first is an assumption this code makes from the names that appear in the documentation. It does not say what a name without a processor letter, such as `m5.large`, means. The `gr` and `f` of `gr6f`, and the `dl` of `dl1`, were not in its lists when read on 2026-10-13. The code reports a part that is not listed as "not on the naming page" and does not guess.

There is more a name does not tell you. The number of vCPUs, the amount of memory, the threads per core, whether Nitro Enclaves is supported, and which Regions offer the type are not in the name. Look them up in the specification tables of the instance types guide.

To choose for this book's uses, look in three places.

The series follows from the ratio of memory to vCPUs. In the specification tables `c6g.large` has 2 vCPUs and 4 GiB, and `m6g.large` 2 vCPUs and 8 GiB. For one Node.js process, `c` is enough. `t` is a different kind of choice. According to the whitepaper, `t` instances are built on the premise that more CPU and memory is lent out than exists, and they may take turns with other instances on the same core. They are cheaper for it, and they fit an API like chapter 23's that does nothing most of the time. They do not fit work that uses the CPU constantly.

A newer generation has a newer processor and a slightly higher unit price. In the Tokyo Region `m6g.large` is USD 0.099 an hour and `m7g.large` USD 0.1054. How much sooner the same work finishes cannot be derived from the material. You have to measure it with your own work.

The size is chosen from the vCPUs and memory in the specification tables. For a parent of an enclave, a Graviton `large` is the minimum, for the reason in the next section.

## Graviton

<!-- section: 68.graviton -->

Graviton is the Arm processor AWS designs. According to the whitepaper it comes from Annapurna Labs, which also builds the Nitro Cards. In the specification tables, `t4g`, `m6g`, and `c6g` are Graviton2, `m7g` and `c7g` Graviton3, `m8g` and `c8g` Graviton4, and `m9g` and `c9g` Graviton5 (as of 2026-10-13). Lambda's arm64 is Graviton2, says the Lambda documentation. For Fargate's arm64 the documentation says Graviton and names no generation.

This book has made arm64 the default everywhere: the Lambda functions since chapter 04, Fargate in chapter 12, the instance in chapter 23. The reason is the unit price.

```bash
vp run nitro:prices
```

```text
Unit prices in ap-northeast-1, USD, list price (arm64 / x86)
  EC2 t4g.micro and t3.micro, per hour     0.0108000000 / 0.0136000000  arm64 is 20.6% less
  EC2 c6g.large and c6i.large, per hour    0.0856000000 / 0.1070000000  arm64 is 20.0% less
  Fargate, per vCPU-hour                   0.0404500000 / 0.0505600000  arm64 is 20.0% less
  Fargate, per GB-hour of memory           0.0044200000 / 0.0055300000  arm64 is 20.1% less
  Lambda, per GB-second (first tier)       0.0000133334 / 0.0000166667  arm64 is 20.0% less
```

For every unit, arm64 costs about a fifth less. AWS's product page says the same: up to 20% less than comparable x86 instances. The pairs being compared are in the code.

<<< @/examples/68-nitro/src/arch.ts{compare}

This compares unit prices, not what the same work costs. If the amount of work one unit does differs between processors, the difference becomes larger or smaller than a fifth. The book has measured neither.

Beside the price there is a difference in how vCPUs are counted. According to the whitepaper, an x86 instance is given the two threads of one core as 2 vCPUs, and Graviton gives one core as 1 vCPU. The specification tables agree: `c6g.large` is 2 vCPUs on 2 cores, `c6i.xlarge` is 4 vCPUs on 2 cores. The same "2 vCPUs" holds a different number of cores.

That difference sets the minimum for a parent instance. An enclave is given at least one whole core, and one is left for the parent. The Nitro Enclaves FAQ says it is not available on instances with only one CPU core. In the list of supported instance types, every x86 family that has a `large` excludes it, while Graviton families are in from `large`. As a result the smallest parent is a `c6g.large` at USD 0.0856 an hour on Graviton, and a `c6i.xlarge` at USD 0.214 on x86 of the same generation: two fifths of the price.

Moving to arm64 breaks some things.

- **Native modules.** An npm package with a part written in C or Rust needs a binary for arm64. The Lambda documentation tells you to check, before moving, that every dependency provides an arm64 version. A function that bundles only JavaScript, like chapter 04's, runs unchanged
- **Container images.** An image is a different thing per architecture. Chapter 12 passed `--platform linux/arm64` to `docker build` because the task definition asks for arm64. An image built for x86 cannot run in an arm64 task. Shipping both under one tag belongs to [chapter 52](/en/chapters/52-ecr.md)
- **Lambda layers and extensions.** These too have to exist for the architecture, says the Lambda documentation
- **The build machine.** If the CI machine is x86, building arm64 images or binaries needs its own setup
- **The operating system.** Graviton supports only Linux, says the documentation

A reason to choose x86 is usually one of these. One dependency without an arm64 version settles it.
