import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { SignatureV4 } from "@smithy/signature-v4";

// #region sign
/** A POST to a function URL with AuthType AWS_IAM, signed with the caller's own credentials. */
export async function signedPost(
  url: URL,
  region: string,
  body: string,
  signal?: AbortSignal,
): Promise<Response> {
  // Function URLs are signed for the service name "lambda".
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
    headers: { host: url.hostname, "content-type": "application/json" },
    body,
  });
  return fetch(url, {
    method: "POST",
    headers: signed.headers,
    body,
    ...(signal === undefined ? {} : { signal }),
  });
}
// #endregion sign
