// The code meant to run inside the enclave. It knows nothing of vsock, attestation, or KMS:
// it gets a KeyService and bytes, so the same file runs in the tests.

import { createCipheriv, createDecipheriv } from "node:crypto";

import * as v from "valibot";

import {
  type EnclaveRequest,
  type EnclaveResponse,
  requestSchema,
  type Sealed,
} from "./protocol.ts";

// #region keys
/** How the vault gets data keys. Inside an enclave both calls carry its attestation document. */
export type KeyService = {
  newDataKey(roleArn: string): Promise<{ plaintext: Uint8Array; wrapped: Uint8Array }>;
  unwrap(roleArn: string, wrapped: Uint8Array): Promise<Uint8Array>;
};

/** KMS said no, or the answer could not be opened with this enclave's private key. */
export class KeyRefused extends Error {}
// #endregion keys

// #region vault
// The owner and the note ID are authenticated with the text: a ciphertext moved to
// another note, or to another owner, does not open.
const aad = (owner: string, noteId: string): Uint8Array => Buffer.from(`${owner}\n${noteId}`);

async function seal(
  request: Extract<EnclaveRequest, { op: "seal" }>,
  keys: KeyService,
  randomBytes: (size: number) => Uint8Array,
): Promise<Sealed> {
  const { plaintext: dataKey, wrapped } = await keys.newDataKey(request.credentials.roleArn);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
    cipher.setAAD(aad(request.owner, request.noteId));
    const ciphertext = Buffer.concat([cipher.update(request.body, "utf8"), cipher.final()]);
    return {
      wrappedKey: Buffer.from(wrapped).toString("base64"),
      iv: Buffer.from(iv).toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  } finally {
    // One key per note, and it does not outlive the call.
    dataKey.fill(0);
  }
}

async function open(
  request: Extract<EnclaveRequest, { op: "open" }>,
  keys: KeyService,
): Promise<string | undefined> {
  const { sealed } = request;
  const dataKey = await keys.unwrap(
    request.credentials.roleArn,
    Buffer.from(sealed.wrappedKey, "base64"),
  );
  try {
    const decipher = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(sealed.iv, "base64"));
    decipher.setAAD(aad(request.owner, request.noteId));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return undefined;
  } finally {
    dataKey.fill(0);
  }
}

/** One request in, one response out. This is the whole surface the parent can reach. */
export function createVault(keys: KeyService, randomBytes: (size: number) => Uint8Array) {
  return async (message: Uint8Array): Promise<EnclaveResponse> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(message).toString("utf8"));
    } catch {
      return { ok: false, error: "bad-request" };
    }
    const request = v.safeParse(requestSchema, parsed);
    if (!request.success) {
      return { ok: false, error: "bad-request" };
    }
    try {
      if (request.output.op === "seal") {
        return { ok: true, sealed: await seal(request.output, keys, randomBytes) };
      }
      const body = await open(request.output, keys);
      return body === undefined ? { ok: false, error: "not-authentic" } : { ok: true, body };
    } catch (error) {
      if (error instanceof KeyRefused) {
        return { ok: false, error: "key-refused" };
      }
      throw error;
    }
  };
}
// #endregion vault
