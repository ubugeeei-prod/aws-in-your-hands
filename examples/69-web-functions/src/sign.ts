import { createHash } from "node:crypto";

import { Sha256 } from "@aws-crypto/sha256-js";
import { SignatureV4 } from "@smithy/signature-v4";

export type Credentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };

export type SignedRequest = { url: string; method: string; headers: Record<string, string> };

// #region sign
/**
 * A request an IamAuth endpoint accepts: Signature Version 4, service "lambda".
 * Lambda does not read the body to check the signature. It takes the hash from
 * x-amz-content-sha256, and refuses a request that comes without that header.
 */
export async function signRequest(input: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  region: string;
  credentials: Credentials | (() => Promise<Credentials>);
  now?: Date;
}): Promise<SignedRequest> {
  const url = new URL(input.url);
  const signer = new SignatureV4({
    service: "lambda",
    region: input.region,
    credentials: input.credentials,
    sha256: Sha256,
  });
  const signed = await signer.sign(
    {
      method: input.method,
      protocol: url.protocol,
      hostname: url.hostname,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: {
        ...input.headers,
        // The endpoint's own domain, lowercase and without a port: Lambda routes on it.
        host: url.hostname,
        "x-amz-content-sha256": createHash("sha256")
          .update(input.body ?? "")
          .digest("hex"),
      },
      ...(input.body === undefined ? {} : { body: input.body }),
    },
    input.now === undefined ? {} : { signingDate: input.now },
  );
  return { url: input.url, method: input.method, headers: signed.headers };
}
// #endregion sign

/** `fetch`, with every request signed. Bodies are strings: that is all the notes client sends. */
export function signedFetch(
  region: string,
  credentials: Credentials | (() => Promise<Credentials>),
): typeof fetch {
  return async (target, init = {}) => {
    const body = typeof init.body === "string" ? init.body : undefined;
    const signed = await signRequest({
      url: String(target),
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers)),
      ...(body === undefined ? {} : { body }),
      region,
      credentials,
    });
    return fetch(signed.url, { ...init, method: signed.method, headers: signed.headers });
  };
}
