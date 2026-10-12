import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { SignatureV4 } from "@smithy/signature-v4";

import { OWNER_HEADER } from "../src/owner.ts";

// #region sign
/** Chapter 17's signed POST with one header more: the owner, inside the signature. */
export async function signedPost(
  url: URL,
  region: string,
  owner: string,
  body: string,
): Promise<Response> {
  const signer = new SignatureV4({
    service: "lambda",
    region,
    credentials: defaultProvider(),
    sha256: Sha256,
  });
  const signed = await signer.sign({
    method: "POST",
    protocol: url.protocol,
    hostname: url.hostname,
    path: url.pathname,
    headers: { host: url.hostname, "content-type": "application/json", [OWNER_HEADER]: owner },
    body,
  });
  return fetch(url, { method: "POST", headers: signed.headers, body });
}
// #endregion sign
