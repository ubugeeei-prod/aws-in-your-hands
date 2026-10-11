import { jwtVerify, SignJWT } from "jose";
import type { Identity } from "./identity.ts";

// Local sign-in for development, not an emulation of Cognito. Tokens are HS256
// with a shared secret, and the deployed JWT authorizer accepts RSA-based algorithms only.

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
      // Expired, forged, wrong audience, not a JWT: all mean "nobody".
      return undefined;
    }
  };
}
