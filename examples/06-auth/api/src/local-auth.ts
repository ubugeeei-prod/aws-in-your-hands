import { jwtVerify, SignJWT } from "jose";
import type { Identity } from "./identity.ts";

// Local sign-in for development. It exists so that the API and the SPA can be
// run and tested by more than one "user" without a user pool.
//
// This is not an emulation of Cognito. The tokens are signed with a shared
// secret (HS256); Cognito signs with RSA keys, and API Gateway's JWT
// authorizer accepts only RSA-based algorithms, so a token made here cannot
// pass the deployed authorizer. Managed login, refresh tokens, expiry policy,
// and revocation are not represented at all.

const ISSUER = "http://localhost/aih-local";
const AUDIENCE = "aih-notes-local";

const key = (secret: string): Uint8Array => {
  if (secret.length < 32) {
    throw new Error("LOCAL_AUTH_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(secret);
};

export function signLocalToken(secret: string, sub: string, lifetimeSeconds = 3600): Promise<string> {
  return new SignJWT({ token_use: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${lifetimeSeconds}s`)
    .sign(key(secret));
}

export function createLocalAuthenticator(secret: string) {
  const verificationKey = key(secret);
  return async (request: { authorization: string | undefined }): Promise<Identity | undefined> => {
    const match = /^Bearer (.+)$/.exec(request.authorization ?? "");
    if (match?.[1] === undefined) {
      return undefined;
    }
    try {
      const { payload } = await jwtVerify(match[1], verificationKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ["HS256"],
      });
      return typeof payload.sub === "string" && payload.sub !== "" ? { sub: payload.sub } : undefined;
    } catch {
      // Expired, wrong signature, wrong audience, not a JWT: all of them mean "nobody".
      return undefined;
    }
  };
}
