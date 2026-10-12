// A model of the two KMS calls this chapter uses, with and without the Recipient parameter.
// Field names follow the KMS API. The real CiphertextForRecipient is a CMS envelope; here
// the plaintext is encrypted to the recipient's RSA key directly.

import {
  constants,
  createCipheriv,
  createDecipheriv,
  type KeyObject,
  publicEncrypt,
} from "node:crypto";

import { evaluate } from "../policy.ts";
import { type Attested, verifyAttestation } from "./attestation.ts";

// The model's own errors. Which exception the real service returns in each case was not checked.
export class AccessDenied extends Error {}
export class InvalidAttestation extends Error {}
export class InvalidCiphertext extends Error {}

// #region types
export type KmsRequest = {
  /** Who signed the request: the instance role, whether the parent or the enclave sends it. */
  principal: string;
  /** The signed attestation document. Absent on an ordinary call. */
  recipient?: Uint8Array;
};

export type KmsResponse = {
  /** Present only when the request carried no attestation document. */
  Plaintext?: Uint8Array;
  /** Present only when it did: the plaintext, readable with the enclave's private key. */
  CiphertextForRecipient?: Uint8Array;
};

export type KmsModel = {
  generateDataKey(request: KmsRequest): KmsResponse & { CiphertextBlob: Uint8Array };
  decrypt(request: KmsRequest & { ciphertextBlob: Uint8Array }): KmsResponse;
};
// #endregion types

// #region kms
export function createKmsModel(options: {
  /** The key policy, as JSON. Read again on every call. */
  policy: unknown;
  /** The hypervisor key this KMS trusts. */
  trusted: KeyObject;
  randomBytes: (size: number) => Uint8Array;
}): KmsModel {
  // The KMS key itself. It has no accessor: nothing in this file returns it.
  const keyMaterial = options.randomBytes(32);

  const authorize = (action: string, request: KmsRequest): Attested | undefined => {
    let attested: Attested | undefined;
    if (request.recipient !== undefined) {
      attested = verifyAttestation(request.recipient, options.trusted);
      if (attested === undefined) {
        throw new InvalidAttestation("the attestation document is not valid");
      }
    }
    const decision = evaluate(options.policy, {
      principal: request.principal,
      action,
      ...(attested === undefined ? {} : { attestedPcrs: attested.pcrs }),
    });
    if (!decision.allowed) {
      throw new AccessDenied(`${action}: ${decision.because}`);
    }
    return attested;
  };

  // With a document, the answer goes to the key in the document and to nobody else.
  const answer = (plaintext: Uint8Array, attested: Attested | undefined): KmsResponse =>
    attested === undefined
      ? { Plaintext: plaintext }
      : {
          CiphertextForRecipient: publicEncrypt(
            {
              key: attested.publicKey,
              padding: constants.RSA_PKCS1_OAEP_PADDING,
              oaepHash: "sha256",
            },
            plaintext,
          ),
        };

  return {
    generateDataKey(request) {
      const attested = authorize("kms:GenerateDataKey", request);
      const dataKey = options.randomBytes(32);
      const iv = options.randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", keyMaterial, iv);
      const wrapped = Buffer.concat([cipher.update(dataKey), cipher.final()]);
      return {
        CiphertextBlob: Buffer.concat([iv, cipher.getAuthTag(), wrapped]),
        ...answer(dataKey, attested),
      };
    },
    decrypt(request) {
      const attested = authorize("kms:Decrypt", request);
      const blob = Buffer.from(request.ciphertextBlob);
      try {
        const decipher = createDecipheriv("aes-256-gcm", keyMaterial, blob.subarray(0, 12));
        decipher.setAuthTag(blob.subarray(12, 28));
        const dataKey = Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
        return answer(dataKey, attested);
      } catch {
        throw new InvalidCiphertext("the ciphertext was not produced by this key");
      }
    },
  };
}
// #endregion kms
