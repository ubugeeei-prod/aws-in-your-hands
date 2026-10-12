---
title: "68 Nitro: Run It Locally"
---

# 68 Nitro: Run It Locally

## Run it locally

<!-- section: 68.local -->

Nothing of the Nitro System runs on a laptop. The hypervisor, the enclave, and KMS exist only inside AWS. What runs locally is a model of who can see which bytes between a parent instance, an enclave, and KMS. No AWS account is needed.

```bash
vp run nitro:demo
```

```text
PCR0 of the model image   23f63eab16c93e729ec3aed808d035b386c1063588b2cd537b7a7b7b15cd8a216e691570dccea78d03846d328d1e2494

parent asks the enclave to seal a note         sealed
parent asks the enclave to open it             "the note"
parent calls Decrypt with the same role        refused: kms:Decrypt: no statement allows this call
parent replays the enclave's document          answered
the same image in debug mode asks for a key    key-refused

Data keys issued: 1. In the parent's hands: none.
The note's text did pass through the parent. Only the key did not.
```

The `refused` line is the parent calling `Decrypt` with the same role as the enclave and being turned away. On the next line the parent has copied the enclave's document in passing and attached it again. KMS answers, but the answer is ciphertext addressed to the public key in the document, and the parent cannot open it. The `key-refused` line is the same image started as an enclave in debug mode. Its PCR0 is zero, so it gets no key.

The model has four parts.

The first plays the hypervisor. It boots an enclave from an image and gives that enclave, and only it, a way to obtain a document. The image decides the measurement, not the caller.

<<< @/examples/68-nitro/src/enclave/attestation.ts{hypervisor}

The second plays KMS. If a document is attached it verifies the signature, evaluates the policy, and answers to the public key in the document.

<<< @/examples/68-nitro/src/enclave/kms-model.ts{kms}

The third is the evaluator for key policies.

<<< @/examples/68-nitro/src/policy.ts{evaluate}

The fourth is the enclave and its parent. The enclave creates a key pair at boot and runs the `createVault` of the previous page. All the parent has is a way to send bytes and receive bytes.

<<< @/examples/68-nitro/src/enclave/model.ts{enclave}

The parent records every byte string that comes into its hands: its exchange with the enclave, and the exchange with KMS that it relays for the enclave. The check of the invariant looks for a data key in that record.

<<< @/examples/68-nitro/src/enclave/model.ts{invariant}

Where this model differs from the real thing should be clear.

- The document is JSON, signed with one key. The real one is CBOR and COSE, with a chain of certificates up to AWS's root certificate
- PCR0 is a hash of the image's name and version strings. The real one is computed from the contents of the image file, so changing one byte changes it. In the model, forgetting to change the version string gives the same value
- `CiphertextForRecipient` is the plaintext encrypted directly with the public key. The real format is different, and this chapter does not cover it
- The evaluator reads only `Allow` and `Deny`, principals and actions written out in full, a `Resource` of `"*"`, and `StringEqualsIgnoreCase` with the two kinds of condition key. On a wildcard, or any other operator or condition key, it throws instead of reading "no restriction". It knows nothing of IAM policies, grants, or SCPs
- The real parent forwards the traffic to KMS as TLS and cannot read it. The model's parent records it in the clear. That only makes the tests stricter

The evaluator is not KMS. It exists to check that this chapter's policy is not being misread, and that removing the condition changes the outcome. How KMS actually answers can be learned only by the steps on the [deploy](/en/chapters/68-nitro/deploy.md) page.

The tests try to break the invariant.

- The parent calls `Decrypt` and `GenerateDataKey` itself, with the enclave's role. Refused
- The parent attaches the document it saw while relaying and calls `Decrypt`. Only ciphertext comes back
- The parent presents a document signed with its own key, carrying the right PCR0. It fails signature verification
- The parent edits only the PCR0 in a genuine document. The signature no longer matches
- The parent boots an enclave from an image with changed contents. PCR0 differs, so no key
- The parent boots the right image in debug mode. PCR0 is zero, so no key
- The policy is written without the condition. The parent obtains a plaintext data key, and the check fails
- An image that returns the key to the outside is registered in the policy. Attestation succeeds, and the check fails

The last two are tests that the invariant breaks. They show that the check really does detect a broken state.

The other tasks are these.

```bash
vp run test:unit
vp run nitro:names
vp run nitro:prices
vp run nitro:infra:synth
vp run nitro:infra:synth -c measurement=7fb5c55bc2ecbb68ed99a13d7122abfc0666b926a79d5379bc58b9445c84217f59cfdd36c08b2c79552928702efe23e4
```

`nitro:infra:synth` writes the template to `examples/68-nitro/cdk.out/`. It asks AWS nothing. The value on the last line is the PCR0 from an example in the documentation. The stack tests feed the key policy of the synthesized template to the same evaluator and check that it refuses without a document, refuses a PCR0 of zeros, and allows only the PCR0 that was given.

Some things are not reproduced locally: the hypervisor's isolation, the real signature on a document, KMS's real decision, vsock, and the time and memory an enclave takes to start. Passing tests show only that this chapter's policy and sealing code behave as written, on the model.
