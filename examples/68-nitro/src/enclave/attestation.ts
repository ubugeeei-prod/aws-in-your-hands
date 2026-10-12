// A model of the Nitro Hypervisor's part in attestation, for the tests of this chapter.
// The real document is CBOR, signed as COSE_Sign1, with a certificate chain up to the AWS
// Nitro Attestation PKI. Here it is JSON, signed by one key that stands for that chain.

import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify,
} from "node:crypto";

import * as v from "valibot";

import { DEBUG_PCR } from "../measurement.ts";

// #region image
/** What `nitro-cli build-enclave` turns into an .eif file. In the model, only its label. */
export type EnclaveImage = { name: string; version: string };

/**
 * The model's PCR0. The real one is computed over the image file, so any changed byte
 * changes it. This one trusts the label: a new build must be given a new version.
 */
export const measure = (image: EnclaveImage): string =>
  createHash("sha384")
    .update(JSON.stringify([image.name, image.version]))
    .digest("hex");
// #endregion image

// #region document
// The fields of the real attestation document that the model keeps, under their real names.
const documentSchema = v.object({
  module_id: v.string(),
  timestamp: v.number(),
  digest: v.literal("SHA384"),
  pcrs: v.record(v.string(), v.pipe(v.string(), v.regex(/^[0-9a-f]{96}$/))),
  // DER, base64. Whoever checks the document encrypts its answer to this key.
  public_key: v.optional(v.string()),
});
export type AttestationDocument = v.InferOutput<typeof documentSchema>;

const signedSchema = v.object({ document: v.string(), signature: v.string() });
// #endregion document

// #region hypervisor
/** What an enclave can ask of the hypervisor about itself, and about nothing else. */
export type SecureModule = {
  /** A signed document carrying this enclave's measurements and the given public key. */
  attest(publicKey: KeyObject): Uint8Array;
};

export type Hypervisor = {
  /** What a verifier trusts. In AWS this is the published root certificate. */
  rootPublicKey: KeyObject;
  /** Starts an enclave from an image. The measurements come from the image, not the caller. */
  launch(image: EnclaveImage, options?: { debug?: boolean }): SecureModule;
};

export function createHypervisor(now: () => number): Hypervisor {
  const root = generateKeyPairSync("ec", { namedCurve: "P-384" });
  return {
    rootPublicKey: root.publicKey,
    launch(image, options = {}) {
      // Debug mode lets the parent read the console, so the document must not vouch for it.
      const pcr0 = options.debug === true ? DEBUG_PCR : measure(image);
      return {
        attest(publicKey) {
          const document = JSON.stringify({
            module_id: `model-${image.name}`,
            timestamp: now(),
            digest: "SHA384",
            pcrs: { "0": pcr0 },
            public_key: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
          } satisfies AttestationDocument);
          const signature = sign("sha384", Buffer.from(document), root.privateKey);
          return Buffer.from(JSON.stringify({ document, signature: signature.toString("base64") }));
        },
      };
    },
  };
}
// #endregion hypervisor

// #region verify
export type Attested = { pcrs: Record<number, string>; publicKey: KeyObject };

/** What KMS does first: is this document signed by the hypervisor? undefined when it is not. */
export function verifyAttestation(bytes: Uint8Array, trusted: KeyObject): Attested | undefined {
  try {
    const signed = v.parse(signedSchema, JSON.parse(Buffer.from(bytes).toString("utf8")));
    const genuine = verify(
      "sha384",
      Buffer.from(signed.document),
      trusted,
      Buffer.from(signed.signature, "base64"),
    );
    if (!genuine) {
      return undefined;
    }
    const document = v.parse(documentSchema, JSON.parse(signed.document));
    if (document.public_key === undefined) {
      return undefined;
    }
    return {
      pcrs: Object.fromEntries(
        Object.entries(document.pcrs).map(([index, value]) => [Number(index), value]),
      ),
      publicKey: createPublicKey({
        key: Buffer.from(document.public_key, "base64"),
        type: "spki",
        format: "der",
      }),
    };
  } catch {
    // Not JSON, not the shape, not a key: all the same answer to the caller.
    return undefined;
  }
}
// #endregion verify
