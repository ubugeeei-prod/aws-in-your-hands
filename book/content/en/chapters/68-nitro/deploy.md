---
title: "68 Nitro: Deploy"
---

# 68 Nitro: Deploy

None of the steps on this page were run. The commands typed on the instance are copied from the Nitro Enclaves user guide, and the AWS CLI arguments from the help of the devShell's AWS CLI 2.35.11. Building an enclave image needs Docker. The Nix devShell has no Docker daemon, so the build happens on the instance. When you try them, remember that the instance is billed by the hour and get to [the cleanup](/en/chapters/68-nitro/wrap.md) the same day.

## Deploying

<!-- section: 68.deploy -->

The chapter 11 network comes first, with its default settings. This chapter's instance sits in a public subnet, so it uses no interface endpoints.

```bash
vp run net:infra:deploy
vp run nitro:infra:diff
vp run nitro:infra:deploy
```

`nitro:infra:diff` shows the resources to be created. There should be five: the security group, the role, the instance profile, the KMS key, and the instance. When the deploy finishes, the stack outputs give `InstanceId`, `KeyId`, and `ParentRoleArn`.

The first thing to check is that enclaves are enabled on the instance. That the pinned cdkd passes this property through Cloud Control API is something this chapter did not confirm on the real thing.

```bash
aws ec2 describe-instances --region ap-northeast-1 --instance-ids i-xxxxxxxxxxxxxxxxx --query 'Reservations[].Instances[].EnclaveOptions'
```

If `Enabled` is not `true`, the steps that follow will not work. In that case look at what cdkd sent in the output of `nitro:infra:deploy`, and go to the resume steps in the verification notes.

At this point the key policy holds only the administrative statement. The key exists, and nobody can use it.

The drift check is the same as in chapter 23.

```bash
vp run nitro:infra:drift
```

## Getting an enclave started

<!-- section: 68.walkthrough -->

Enter the instance with Session Manager. As in chapter 23, that needs the Session Manager plugin.

```bash
aws ssm start-session --region ap-northeast-1 --target i-xxxxxxxxxxxxxxxxx
```

From here the commands are typed on the instance. First install the Nitro CLI and the development package with the samples, and add yourself to two groups.

```bash
sudo dnf install aws-nitro-enclaves-cli -y
sudo dnf install aws-nitro-enclaves-cli-devel -y
sudo usermod -aG ne $USER
sudo usermod -aG docker $USER
```

The group changes take effect only after you log in again. Close the session and enter once more.

Next, set aside the vCPUs and memory that enclaves will be given. A service called the allocator does that, and the amounts are in `/etc/nitro_enclaves/allocator.yaml`. The default is 512 MiB and 2 vCPUs. The user guide says a Graviton instance with 2 vCPUs must set aside only 1. A `c6g.large` is such an instance, so change the line `cpu_count: 2` to `cpu_count: 1` and then enable the service. The file's format was checked in the Nitro CLI repository on GitHub. Whether the packaged file is the same is what the second line shows you.

```bash
sudo sed -i 's/^cpu_count: 2$/cpu_count: 1/' /etc/nitro_enclaves/allocator.yaml
grep -E '^(cpu_count|memory_mib)' /etc/nitro_enclaves/allocator.yaml
sudo systemctl enable --now nitro-enclaves-allocator.service
sudo systemctl enable --now docker
nitro-cli --version
```

Now an enclave can be started. The user guide's first tutorial is a sample that prints one line every five seconds. Build a Docker image and convert it into an image file.

```bash
docker build /usr/share/nitro_enclaves/examples/hello -t hello
nitro-cli build-enclave --docker-uri hello:latest --output-file hello.eif
```

The second line prints the measurements. In the user guide's example they look like this. The values differ per image.

```text
Start building the Enclave Image...
Enclave Image successfully created.
{
  "Measurements": {
    "HashAlgorithm": "Sha384 { ... }",
    "PCR0": "<96 hex digits>",
    "PCR1": "<96 hex digits>",
    "PCR2": "<96 hex digits>"
  }
}
```

Start the enclave. Use debug mode at first, to see the console.

```bash
nitro-cli run-enclave --cpu-count 1 --memory 512 --enclave-cid 16 --eif-path hello.eif --debug-mode
nitro-cli describe-enclaves
nitro-cli console --enclave-id i-xxxxxxxxxxxxxxxxx-encxxxxxxxxxxxxxxxxx
nitro-cli terminate-enclave --enclave-id i-xxxxxxxxxxxxxxxxx-encxxxxxxxxxxxxxxxxx
```

The user guide writes `--cpu-count 2`, because its example is an `m5.xlarge` with 4 vCPUs. On this chapter's instance 1 vCPU was set aside, hence 1. According to the user guide, `describe-enclaves` returns one enclave with a `State` of `RUNNING` and `Flags` of `DEBUG_MODE`, and `console` shows `Hello from the enclave side!` every five seconds. The enclave ID in the output of `run-enclave` goes into the third and fourth lines.

The Dockerfiles of the tutorials pull base images such as `amazonlinux:2023` and `alpine:latest` from a registry. That is why the instance is in a public subnet. Which image the hello sample pulls was not checked. Whether the default root volume has room for the Docker images and the image file was not checked either.

## Putting the measurement into the key policy

Pass the PCR0 that `build-enclave` printed to the stack.

```bash
vp run nitro:infra:diff -c measurement=<PCR0>
vp run nitro:infra:deploy -c measurement=<PCR0>
```

Only the key's policy should change. If the diff shows the instance being replaced, stop without deploying. Deploy again without `-c measurement=` and the policy goes back to the form nobody can use.

The key now answers only requests that carry a document with this PCR0. The hello sample does not call KMS, so from here you follow two tutorials of the user guide in order: "Connect the parent instance with an enclave by using virtio-vsock" and "Connect an enclave with AWS KMS". Five points have to be read differently for this chapter's setup.

- **The Region.** The user guide's examples use `us-east-1`. Make the vsock-proxy allow list and the `--region` of `kmstool_enclave_cli` all `ap-northeast-1`. The allow list is `/etc/nitro_enclaves/vsock-proxy.yaml`, and the service is `nitro-enclaves-vsock-proxy.service`
- **The measurement.** PCR0 changes with every rebuild of the image. Once you have built the tutorial's image, deploy again with its PCR0
- **Debug mode.** The tutorials start the enclave with `--debug-mode`. Such an enclave's PCR0 is zero, so under this chapter's policy it gets no key. `measurement` is made to refuse an all-zero value. To see attestation at work, start the enclave without debug mode
- **How the ciphertext is made.** The tutorial makes a ciphertext by calling `aws kms encrypt` from your machine. This chapter's key allows `kms:Encrypt` to nobody. Instead, create a data key from inside the enclave with `kmstool_enclave_cli genkey` and pass the `CIPHERTEXT` it prints to `decrypt`. Both commands are in the README of `kmstool-enclave-cli`
- **The IMDSv2 hop limit.** The tutorial's program on the parent reads the role's credentials from IMDSv2 inside a container. This chapter's instance sets the hop limit to 1. The EC2 documentation says a bigger value may be needed for containers on the instance. If the credentials cannot be read, run the parent program outside a container, or raise the limit to 2 with `aws ec2 modify-instance-metadata-options`

Once through, there are three things to check. That `decrypt` from inside the enclave succeeds. That passing the same wrapped key to `aws kms decrypt --ciphertext-blob fileb://<file> --key-id <KeyId>` in the parent's shell is refused. That the KMS event in CloudTrail carries the document's information as `recipient` under `additionalEventData`. The second is the result this chapter most wants to see: the same instance, the same role, and a refusal for want of a document.
