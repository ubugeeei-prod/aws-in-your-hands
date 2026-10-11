import { describe, expect, it } from "vite-plus/test";
import { identityFromApiGateway } from "../src/identity.ts";

const event = (claims: unknown) => ({ requestContext: { authorizer: { jwt: { claims, scopes: ["openid"] } } } });
const accessClaims = { sub: "user-1", token_use: "access", client_id: "client-a", scope: "openid", username: "alice" };

describe("identity from API Gateway", () => {
  it("takes the subject from an access token issued to this app's client", () => {
    expect(identityFromApiGateway(event(accessClaims), "client-a")).toEqual({ sub: "user-1" });
  });

  it("refuses an ID token even though API Gateway found its signature valid", () => {
    // An ID token is proof of sign-in meant for the app's own screen. It is
    // signed by the same user pool, so signature and issuer checks pass.
    const idClaims = { sub: "user-1", token_use: "id", aud: "client-a", email: "alice@example.com" };
    expect(identityFromApiGateway(event(idClaims), "client-a")).toBeUndefined();
  });

  it("refuses a token issued to a different app client of the same user pool", () => {
    expect(identityFromApiGateway(event({ ...accessClaims, client_id: "client-b" }), "client-a")).toBeUndefined();
  });

  it("treats an event without authorizer context as nobody, not as anybody", () => {
    expect(identityFromApiGateway({ requestContext: {} }, "client-a")).toBeUndefined();
    expect(identityFromApiGateway(undefined, "client-a")).toBeUndefined();
  });

  it("refuses claims without a subject", () => {
    expect(identityFromApiGateway(event({ ...accessClaims, sub: "" }), "client-a")).toBeUndefined();
  });
});
