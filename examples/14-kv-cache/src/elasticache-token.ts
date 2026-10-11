import { Sha256 } from "@aws-crypto/sha256-js";
import { SignatureV4 } from "@smithy/signature-v4";

export type AwsCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };

export type TokenRequest = {
  /** The serverless cache's name, not its endpoint. */
  cacheName: string;
  /** An ElastiCache user whose authentication mode is IAM. */
  userId: string;
  region: string;
  credentials: AwsCredentials | (() => Promise<AwsCredentials>);
  now: Date;
};

// #region token
/**
 * The password for an IAM-authenticated connection: a SigV4-presigned
 * `GET http://<cache name>/?Action=connect&User=<user>` without its scheme.
 * Nothing is sent anywhere here; ElastiCache checks the signature on AUTH.
 */
export async function elastiCacheAuthToken(request: TokenRequest): Promise<string> {
  // ElastiCache lowercases cache names, and the signature covers the name.
  const host = request.cacheName.toLowerCase();
  const signer = new SignatureV4({
    service: "elasticache",
    region: request.region,
    credentials: request.credentials,
    sha256: Sha256,
  });
  const signed = await signer.presign(
    {
      method: "GET",
      protocol: "http:",
      hostname: host,
      path: "/",
      query: { Action: "connect", User: request.userId, ResourceType: "ServerlessCache" },
      headers: { host },
    },
    // 15 minutes is the longest ElastiCache accepts.
    { expiresIn: 900, signingDate: request.now },
  );
  const query = Object.entries(signed.query ?? {})
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `${host}/?${query}`;
}
// #endregion token
