import { describe, expect, it } from "vite-plus/test";

import { forwardedJwtAuthenticator, identityFromForwardedJwt } from "../src/identity.ts";

const expected = {
  issuer: "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_EXAMPLE",
  clientId: "client-1",
};
const NOW = 1_800_000_000;

const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
/** A token with these claims and a signature nobody made. Written here, not issued by anyone. */
const token = (claims: Record<string, unknown>, signature = "c2lnbmF0dXJl") =>
  `Bearer ${part({ alg: "RS256", kid: "k1" })}.${part(claims)}.${signature}`;
const claims = {
  sub: "user-alice",
  iss: expected.issuer,
  client_id: expected.clientId,
  token_use: "access",
  exp: NOW + 600,
};

describe("the identity in a forwarded access token", () => {
  it("is the token's subject", () => {
    expect(identityFromForwardedJwt(token(claims), expected, NOW)).toEqual({ sub: "user-alice" });
  });

  it("is nobody without the header, as when the runtime takes SigV4 or the allowlist is missing", () => {
    for (const header of [undefined, "", "Bearer", "Bearer not-a-jwt", "Basic dXNlcjpwYXNz"]) {
      expect(identityFromForwardedJwt(header, expected, NOW)).toBeUndefined();
    }
  });

  it("is nobody when the token is not the kind the authorizer was set up for", () => {
    for (const changed of [
      { iss: "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_OTHER" },
      { client_id: "client-2" },
      { token_use: "id" },
      { exp: NOW },
      { exp: "later" },
      { sub: "" },
      { sub: 42 },
    ]) {
      expect(
        identityFromForwardedJwt(token({ ...claims, ...changed }), expected, NOW),
      ).toBeUndefined();
    }
    expect(
      identityFromForwardedJwt(`Bearer aGVhZGVy.bm90LWpzb24.c2ln`, expected, NOW),
    ).toBeUndefined();
  });

  // Pinned so that nobody mistakes this function for a verifier.
  it("does not check the signature: that is the runtime's authorizer, in front of the process", () => {
    expect(identityFromForwardedJwt(token(claims, "Zm9yZ2Vk"), expected, NOW)).toEqual({
      sub: "user-alice",
    });
    expect(identityFromForwardedJwt(token(claims, ""), expected, NOW)).toEqual({
      sub: "user-alice",
    });
  });

  it("reads the clock it is given", async () => {
    const authenticate = forwardedJwtAuthenticator(expected, () => (NOW + 601) * 1000);
    expect(await authenticate({ event: undefined, authorization: token(claims) })).toBeUndefined();
  });
});
