import { describe, expect, it } from "vite-plus/test";
import { parseConfig } from "./config.ts";

describe("runtime config", () => {
  it("accepts the local development config shipped in public/", () => {
    expect(parseConfig({ apiUrl: "http://localhost:8787", auth: { mode: "local" } }).auth.mode).toBe("local");
  });

  it("requires every Cognito setting when the mode is cognito", () => {
    expect(() =>
      parseConfig({ apiUrl: "https://api.example.com", auth: { mode: "cognito", clientId: "abc" } }),
    ).toThrow();
  });

  it("refuses a sign-in domain that is not HTTPS", () => {
    expect(() =>
      parseConfig({
        apiUrl: "https://api.example.com",
        auth: {
          mode: "cognito",
          issuer: "https://cognito-idp.ap-northeast-1.amazonaws.com/p",
          domain: "http://login.example.com",
          clientId: "abc",
        },
      }),
    ).toThrow();
  });
});
