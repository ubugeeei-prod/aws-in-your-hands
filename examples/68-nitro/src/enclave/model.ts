// The parent instance and its enclave, in one process, for the tests and `vp run nitro:demo`.
// It models who can see which bytes. It says nothing about the strength of the real isolation.

import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";

import * as v from "valibot";

import type { EnclaveImage, Hypervisor } from "./attestation.ts";
import {
  AccessDenied,
  InvalidAttestation,
  InvalidCiphertext,
  type KmsModel,
  type KmsResponse,
} from "./kms-model.ts";
import { type EnclaveResponse, responseSchema, type Sealed } from "./protocol.ts";
import { createVault, KeyRefused, type KeyService } from "./vault.ts";

type RandomBytes = (size: number) => Uint8Array;

// #region enclave
/** What an image runs once it has booted. */
export type Program = (parts: {
  keys: KeyService;
  randomBytes: RandomBytes;
}) => (message: Uint8Array) => Promise<EnclaveResponse>;

export type BootableImage = EnclaveImage & { program: Program };

export const VAULT_IMAGE: BootableImage = {
  name: "notes-vault",
  version: "1",
  program: ({ keys, randomBytes }) => createVault(keys, randomBytes),
};

/** All the parent has of a running enclave: bytes in, bytes out. */
export type Enclave = { send(message: Uint8Array): Promise<Uint8Array> };

export function bootEnclave(options: {
  hypervisor: Hypervisor;
  image: BootableImage;
  debug?: boolean;
  /** The parent's proxy to KMS: an enclave has no network of its own. */
  kms: KmsModel;
  randomBytes: RandomBytes;
}): Enclave {
  const module = options.hypervisor.launch(options.image, { debug: options.debug === true });
  // Made inside, at boot. The private half is in no return value of this function.
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  const attested = <Response extends KmsResponse>(call: (recipient: Uint8Array) => Response) => {
    let response: Response;
    try {
      response = call(module.attest(publicKey));
    } catch (error) {
      // The parent chooses the wrapped key it sends in, so a bad one is an answer, not a crash.
      if (
        error instanceof AccessDenied ||
        error instanceof InvalidAttestation ||
        error instanceof InvalidCiphertext
      ) {
        throw new KeyRefused(error.message);
      }
      throw error;
    }
    if (response.CiphertextForRecipient === undefined) {
      throw new KeyRefused("KMS did not answer to this enclave's key");
    }
    const plaintext = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      response.CiphertextForRecipient,
    );
    return { response, plaintext };
  };

  const keys: KeyService = {
    newDataKey: async (roleArn) => {
      const { response, plaintext } = attested((recipient) =>
        options.kms.generateDataKey({ principal: roleArn, recipient }),
      );
      return { plaintext, wrapped: response.CiphertextBlob };
    },
    unwrap: async (roleArn, wrapped) =>
      attested((recipient) =>
        options.kms.decrypt({ principal: roleArn, ciphertextBlob: wrapped, recipient }),
      ).plaintext,
  };

  const handle = options.image.program({ keys, randomBytes: options.randomBytes });
  return {
    send: async (message) => Buffer.from(JSON.stringify(await handle(message))),
  };
}
// #endregion enclave

// #region parent
export type Parent = {
  /** Every byte string that has been in the parent's hands, in order. */
  seen: Uint8Array[];
  /** What the enclave is given as its way to KMS. */
  proxy: KmsModel;
  /** The last attestation document that crossed the proxy. */
  lastAttestation(): Uint8Array | undefined;
  attach(enclave: Enclave): void;
  saveNote(owner: string, noteId: string, body: string): Promise<EnclaveResponse>;
  readNote(owner: string, noteId: string): Promise<EnclaveResponse>;
  stored: Map<string, Sealed>;
};

/**
 * The instance around the enclave. It holds the role, forwards the enclave's KMS traffic,
 * and keeps the sealed notes. The real proxy forwards TLS it cannot read; this one records
 * the KMS requests and answers in the clear, which only makes the test stricter.
 */
export function createParent(options: { roleArn: string; kms: KmsModel }): Parent {
  const seen: Uint8Array[] = [];
  let enclave: Enclave | undefined;
  let attestation: Uint8Array | undefined;
  const stored = new Map<string, Sealed>();

  const record = <Response extends KmsResponse & { CiphertextBlob?: Uint8Array }>(
    recipient: Uint8Array | undefined,
    response: Response,
  ): Response => {
    attestation = recipient ?? attestation;
    for (const bytes of [
      recipient,
      response.Plaintext,
      response.CiphertextForRecipient,
      response.CiphertextBlob,
    ]) {
      if (bytes !== undefined) {
        // A copy: what the parent saw stays seen, even if the owner wipes its buffer later.
        seen.push(Buffer.from(bytes));
      }
    }
    return response;
  };
  const proxy: KmsModel = {
    generateDataKey: (request) => record(request.recipient, options.kms.generateDataKey(request)),
    decrypt: (request) => record(request.recipient, options.kms.decrypt(request)),
  };

  const ask = async (request: object): Promise<EnclaveResponse> => {
    if (enclave === undefined) {
      throw new Error("no enclave is running");
    }
    const message = Buffer.from(JSON.stringify(request));
    const answer = await enclave.send(message);
    seen.push(message, answer);
    return v.parse(responseSchema, JSON.parse(Buffer.from(answer).toString("utf8")));
  };
  const credentials = { roleArn: options.roleArn };
  const key = (owner: string, noteId: string) => `${owner}/${noteId}`;

  return {
    seen,
    proxy,
    lastAttestation: () => attestation,
    stored,
    attach(running) {
      enclave = running;
    },
    async saveNote(owner, noteId, body) {
      const response = await ask({ op: "seal", credentials, owner, noteId, body });
      if (response.ok && "sealed" in response) {
        stored.set(key(owner, noteId), response.sealed);
      }
      return response;
    },
    async readNote(owner, noteId) {
      const sealed = stored.get(key(owner, noteId));
      return sealed === undefined
        ? { ok: false, error: "bad-request" }
        : ask({ op: "open", credentials, owner, noteId, sealed });
    },
  };
}
// #endregion parent

// #region invariant
/** True when `secret` has been in the parent's hands, as raw bytes or as base64 text. */
export function parentHolds(parent: Pick<Parent, "seen">, secret: Uint8Array): boolean {
  const raw = Buffer.from(secret);
  const text = Buffer.from(raw.toString("base64"));
  return parent.seen.some((bytes) => {
    const held = Buffer.from(bytes);
    return held.includes(raw) || held.includes(text);
  });
}
// #endregion invariant
