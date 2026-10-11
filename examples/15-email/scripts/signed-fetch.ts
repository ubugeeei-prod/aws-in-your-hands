import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { SignatureV4 } from "@smithy/signature-v4";

// #region signed-fetch
/** fetch() for a route with IAM authorization: signs the request with your own credentials (SigV4). */
export async function signedFetch(url: URL, region: string, init: { method: string; body?: string }) {
  const signer = new SignatureV4({ service: "execute-api", region, credentials: defaultProvider(), sha256: Sha256 });
  const signed = await signer.sign({
    method: init.method,
    protocol: url.protocol,
    hostname: url.hostname,
    path: url.pathname,
    headers: {
      host: url.hostname,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: init.body }),
  });
  return fetch(url, {
    method: init.method,
    headers: signed.headers,
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}
// #endregion signed-fetch
