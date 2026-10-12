import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { SignatureV4 } from "@smithy/signature-v4";

/** A request to a function URL with AuthType AWS_IAM, signed with the caller's own credentials. */
export async function signedFetch(
  method: "GET" | "POST",
  url: URL,
  region: string,
  body?: string,
): Promise<Response> {
  // Function URLs are signed for the service name "lambda", as in chapter 17.
  const signer = new SignatureV4({
    service: "lambda",
    region,
    credentials: defaultProvider(),
    sha256: Sha256,
  });
  const signed = await signer.sign({
    method,
    protocol: url.protocol,
    hostname: url.hostname,
    path: url.pathname,
    headers: {
      host: url.hostname,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body }),
  });
  return fetch(url, { method, headers: signed.headers, ...(body === undefined ? {} : { body }) });
}
