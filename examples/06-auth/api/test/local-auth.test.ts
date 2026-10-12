import { SignJWT } from "jose";
import { describe, expect, it } from "vite-plus/test";

import { createLocalAuthenticator, signLocalToken } from "../src/local-auth.ts";

const secret = "test-secret-that-is-at-least-32-chars";
const authenticate = createLocalAuthenticator(secret);
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("local development sign-in", () => {
  it("accepts a token it signed", async () => {
    expect(await authenticate(bearer(await signLocalToken(secret, "local-alice")))).toEqual({
      sub: "local-alice",
    });
  });

  it("rejects a token signed with another secret", async () => {
    const forged = await signLocalToken("another-secret-that-is-at-least-32-chars", "local-alice");
    expect(await authenticate(bearer(forged))).toBeUndefined();
  });

  it("rejects an expired token", async () => {
    expect(
      await authenticate(bearer(await signLocalToken(secret, "local-alice", -10))),
    ).toBeUndefined();
  });

  it("rejects an unsigned token", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "local-alice",
        iss: "http://localhost/aih-local",
        aud: "aih-notes-local",
      }),
    ).toString("base64url");
    expect(await authenticate(bearer(`${header}.${payload}.`))).toBeUndefined();
  });

  it("rejects another audience", async () => {
    const other = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("local-alice")
      .setIssuer("http://localhost/aih-local")
      .setAudience("some-other-api")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));
    expect(await authenticate(bearer(other))).toBeUndefined();
  });

  it("rejects a missing or malformed Authorization header", async () => {
    expect(await authenticate({ authorization: undefined })).toBeUndefined();
    expect(await authenticate({ authorization: "local-alice" })).toBeUndefined();
  });

  it("refuses a short secret", () => {
    expect(() => createLocalAuthenticator("short")).toThrow(/32 characters/);
  });
});
