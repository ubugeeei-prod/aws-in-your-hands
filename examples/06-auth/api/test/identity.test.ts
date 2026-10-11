import { describe, expect, it } from "vite-plus/test";
import { identityFromApiGateway } from "../src/identity.ts";

const event = (claims: unknown) => ({ requestContext: { authorizer: { jwt: { claims, scopes: ["openid"] } } } });
const accessClaims = { sub: "user-1", token_use: "access", client_id: "client-a", scope: "openid", username: "alice" };

describe("identity from API Gateway", () => {
  it("accepts this client's access token", () => {
    expect(identityFromApiGateway(event(accessClaims), "client-a")).toEqual({ sub: "user-1" });
  });

  it("refuses an ID token", () => {
    // Signed by the same user pool, so signature and issuer checks pass.
    const idClaims = { sub: "user-1", token_use: "id", aud: "client-a", email: "alice@example.com" };
    expect(identityFromApiGateway(event(idClaims), "client-a")).toBeUndefined();
  });

  it("refuses another client's token", () => {
    expect(identityFromApiGateway(event({ ...accessClaims, client_id: "client-b" }), "client-a")).toBeUndefined();
  });

  it("treats a missing authorizer context as nobody", () => {
    expect(identityFromApiGateway({ requestContext: {} }, "client-a")).toBeUndefined();
    expect(identityFromApiGateway(undefined, "client-a")).toBeUndefined();
  });

  it("refuses an empty sub", () => {
    expect(identityFromApiGateway(event({ ...accessClaims, sub: "" }), "client-a")).toBeUndefined();
  });
});
