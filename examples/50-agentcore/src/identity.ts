import * as v from "valibot";

import type { Authenticate, Identity } from "@aih/example-06-auth/api/src/identity.ts";

// #region claims
const claimsSchema = v.object({
  sub: v.pipe(v.string(), v.minLength(1)),
  iss: v.string(),
  client_id: v.string(),
  // An ID token names the same person, but it is not what the authorizer was set up to accept.
  token_use: v.literal("access"),
  exp: v.pipe(v.number(), v.integer()),
});

export type Expected = { issuer: string; clientId: string };

function decodeClaims(token: string): unknown {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[1] === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}
// #endregion claims

// #region forwarded
/**
 * Who the forwarded access token says is calling. The signature is NOT checked here:
 * AgentCore Runtime's JWT authorizer checked it before the request reached this process,
 * and nothing else can reach port 8080 of a session's microVM. Outside the runtime this
 * function proves nothing, so the local server never uses it.
 */
export function identityFromForwardedJwt(
  authorization: string | undefined,
  expected: Expected,
  nowSeconds: number,
): Identity | undefined {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)$/.exec(
    authorization ?? "",
  );
  if (match?.[1] === undefined) {
    // No allowlisted header, or an IAM-signed invocation: "nobody", never "anybody".
    return undefined;
  }
  const claims = v.safeParse(claimsSchema, decodeClaims(match[1]));
  if (!claims.success) {
    return undefined;
  }
  const { sub, iss, client_id, exp } = claims.output;
  // The authorizer and this code are configured separately. If they ever disagree, stop.
  if (iss !== expected.issuer || client_id !== expected.clientId || exp <= nowSeconds) {
    return undefined;
  }
  return { sub };
}

export const forwardedJwtAuthenticator =
  (expected: Expected, now: () => number): Authenticate =>
  ({ authorization }) =>
    Promise.resolve(identityFromForwardedJwt(authorization, expected, Math.floor(now() / 1000)));
// #endregion forwarded
