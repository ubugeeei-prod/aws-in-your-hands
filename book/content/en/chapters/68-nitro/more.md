---
title: "68 Nitro: Build, Continued"
---

# 68 Nitro: Build, Continued

Up to [the previous page](/en/chapters/68-nitro/build.md) the subject was the face the Nitro System shows you. This page is about the mechanism you can use yourself: Nitro Enclaves. It covers what an enclave is, what it can prove, and how KMS uses that, and ends with the design for the notes app and the stack.

## An enclave and its measurements

<!-- section: 68.enclave -->

An enclave is a virtual machine made by carving vCPUs and memory out of a parent instance. It has its own kernel, and the vCPUs and memory carved out disappear from the parent's OS. The documentation says an enclave is separated from its parent by the same Nitro Hypervisor mechanism that separates instances from one another.

Here is what an enclave lacks: a network to the outside, persistent storage, and an interactive way in such as SSH. What it has is a vsock to the parent. A vsock is a socket between a virtual machine and its host, addressed by a number called a CID and a port. The parent's CID is always 3, and the first enclave gets 16 by default.

There are limits too. One parent can have at most four enclaves, and stopping the parent ends them. Enclaves cannot be combined with hibernation. According to the FAQ they are not available on bare metal, on burstable types (T3, for example), or on instances with only one core. That is why the `t4g.micro` of chapter 23 cannot be a parent.

What runs in an enclave is packed into an enclave image file (`.eif`). Give a Docker image to `nitro-cli build-enclave` and you get one file with the OS and the application. That file is not encrypted. The documentation says secrets must not be put into the image. Secrets arrive from outside after boot. So whoever hands them over needs a way to check that the receiver really is an enclave booted from that image.

That way is the measurements. Along with the image file, `build-enclave` prints several SHA-384 hashes, called PCRs (platform configuration registers).

| PCR | A hash of |
| --- | --- |
| PCR0 | The whole image file |
| PCR1 | The Linux kernel and the boot data |
| PCR2 | The application |
| PCR3 | The ARN of the parent instance's IAM role |
| PCR4 | The parent instance's ID |
| PCR8 | The certificate that signed the image file |

PCR0 to PCR2 are fixed at build time, and PCR8 appears only for a signed build. PCR3 and PCR4 have nothing to do with the image: the documentation defines them as SHA-384 over 48 zero bytes followed by the ARN or the instance ID.

<<< @/examples/68-nitro/src/measurement.ts{measurement}

The tests check that the example ARN and instance ID in the documentation produce the hashes printed in the documentation.

Once booted, an enclave can ask the hypervisor for one document: the attestation document. It holds that enclave's PCRs and a public key the enclave supplied, and the whole is signed by AWS. The format is CBOR, the signature COSE, and the signing key chains up to a published certificate authority, the AWS Nitro Attestation PKI. The documentation says the document can be requested only from inside the enclave.

In an enclave started with `--debug-mode`, every PCR in the document is zero. In debug mode the parent can read the enclave's console. The documentation says the documents of such an enclave cannot be used for attestation.

Here the three things are worth keeping apart. What the material states is that a user of the parent, root included, cannot reach inside the enclave. What follows is that this isolation is the same isolation that separates instances from one another. By placing work on EC2 you already trust it; an enclave adds nobody new to trust. What cannot be confirmed from outside is the isolation itself. The signature on an attestation document, on the other hand, can be verified by anyone with the published root certificate. It is one of the few parts of this mechanism that someone outside AWS can check for themselves.

## KMS decides who receives the key

<!-- section: 68.policy -->

KMS can read this attestation document. Attach it to a `Decrypt` or `GenerateDataKey` request in the `Recipient` parameter, and KMS does two things.

First, it changes where the answer goes. Instead of returning plaintext, KMS encrypts the plaintext with the public key from the document and returns it in a field called `CiphertextForRecipient`. `Plaintext` is empty. Only the enclave holding the matching private key can open it.

Second, it makes the document's contents available to policy conditions. There are two kinds of condition key. `kms:RecipientAttestation:ImageSha384` is compared with PCR0, and `kms:RecipientAttestation:PCR<number>` with the PCR of that number. The documentation says that a request without a document does not satisfy such a condition, and permission is denied.

An enclave has no IAM identity of its own. In the documented procedure the parent reads the temporary credentials of the instance's role from IMDSv2 and passes them to the enclave over vsock. The enclave signs its requests with them. To KMS, the caller is the same role whether the parent sends the request or the enclave does. The only difference is whether a document is attached.

So every permission goes into the key policy.

<<< @/examples/68-nitro/src/policy.ts{policy}

There are two statements.

The first hands the administration of the key to the account. Administration only: neither `kms:Decrypt` nor `kms:GenerateDataKey` is in it. The key policy KMS creates by default gives the account `kms:*`. With that, an IAM policy inside the account could allow anyone an unconditional `Decrypt`. The KMS documentation draws attention to this as well.

The second allows the parent instance's role the two operations that hand out a data key. The condition is that PCR0 in the document equals the given measurement. When no measurement is given, this statement is not created at all.

The role itself gets no KMS permission. The KMS documentation says that when the key and the caller are in the same account, the key policy alone can decide access. Leaving the role empty removes the room for an unconditional allow to slip in on the IAM side.

```figure
caption: The enclave calls Decrypt with its document, and KMS answers to the public key in the document. The parent calling with the same role is refused, because it has no document
type: sequence
actor parent: Parent | instance role
actor enc: Enclave
actor hv: Hypervisor
actor kms: AWS KMS
step parent -> enc: open (wrapped key)
step enc -> hv: attest (public key)
step hv --> enc: signed document
step enc -> kms: Decrypt + Recipient
note kms: check signature and PCR0
step kms --> enc: CiphertextForRecipient
note enc: unwrap, decrypt the note
step enc --> parent: note text
step parent -x kms: Decrypt, no document
```

The figure draws the arrow from the enclave to KMS directly. In reality the enclave has no network, so the traffic goes through vsock-proxy on the parent. According to the documentation the TLS session is established between KMS and the enclave, and the parent forwards it without being able to read it.

## Sealing a note

<!-- section: 68.design -->

The design added to the notes app is envelope encryption. Each note gets one data key; the note is encrypted with the data key, and the data key with the KMS key. What is stored is the ciphertext and the wrapped data key. The difference from ordinary envelope encryption is that the data key is created, and unwrapped, inside the enclave only.

The code that runs in the enclave does not know where keys come from. It receives this interface.

<<< @/examples/68-nitro/src/enclave/vault.ts{keys}

The messages that cross the vsock are two kinds of request and their responses, nothing else.

<<< @/examples/68-nitro/src/enclave/protocol.ts{protocol}

Sealing and opening themselves look like this.

<<< @/examples/68-nitro/src/enclave/vault.ts{vault}

The owner and the note ID are passed to the cipher as additional authenticated data. They are not part of the ciphertext, but decryption fails unless the same values are passed when opening. If the parent presents one note's ciphertext as another owner's note, it does not open. The data key is overwritten with zeros once it has been used.

The invariant to protect is one sentence. **The parent instance never holds a plaintext data key.**

What that sentence does not say matters too. The note's text does pass through the parent. The parent receives the user's request, so the text is in the parent's memory both when it asks for sealing and when it receives an opened note. What this design protects is the key. With no key on the parent, someone who takes the parent's disk or a snapshot, or steals the parent role's credentials and calls KMS from elsewhere, cannot read a single stored note. Someone who gets into the parent and can ask the running enclave to open notes one at a time can. Stopping that takes verifying the user's token inside the enclave and encrypting between the user and the enclave. This chapter does not build that.

One more thing is not built: the part that turns this code into an enclave image. Inside an image it would have to listen on a vsock, get a document from the hypervisor, and call KMS with it. The documentation's example opens the vsock in Python and leaves the KMS call to a command AWS distributes, `kmstool_enclave_cli`. The documentation of Node.js 24's `net` module does not mention vsock. No way of running it as TypeScript could be confirmed, so this chapter's code stops at `KeyService`, and what lies beyond is checked on a model ([run it locally](/en/chapters/68-nitro/local.md)).

## The stack

<!-- section: 68.stack -->

The stack creates five resources.

<<< @/examples/68-nitro/infra/lib/nitro-stack.ts{network}

The instance goes into a public subnet of chapter 11. Chapter 23 defaulted to a private subnet, but this chapter's instance pulls images from a container registry when it builds an enclave image, and forwards traffic to KMS on the enclave's behalf. The chapter 11 stack has no setting that adds an endpoint for KMS. There is no inbound rule; the way in is Session Manager, as in chapter 23.

<<< @/examples/68-nitro/infra/lib/nitro-stack.ts{role}

<<< @/examples/68-nitro/infra/lib/nitro-stack.ts{key}

The key is created with `kms.CfnKey`, not `kms.Key`, so that the policy passed in is the whole key policy and no statement is added to it. The policy is written by the `keyPolicy` of the previous section. The tests use the same function, so the policy tested and the policy deployed cannot disagree.

<<< @/examples/68-nitro/infra/lib/nitro-stack.ts{instance}

Enabling enclaves is one line, `enclaveOptions`. The CloudFormation reference says changing this value requires replacing the instance.

The pinned cdkd (0.296.28) needs a note here. Reading the installed version, its implementation for EC2 instances does not handle `EnclaveOptions`, and when a template sets this property it routes that instance through Cloud Control API instead. Nothing was deployed, so that enclaves end up enabled along that route is unconfirmed.

There is no user data. Installing and configuring the Nitro CLI is done by hand on the [deploy](/en/chapters/68-nitro/deploy.md) page, with the commands from the documentation. Steps that were never run did not seem right to turn into a script that runs silently at boot.
