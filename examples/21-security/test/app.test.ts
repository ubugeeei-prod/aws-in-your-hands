import { describe, expect, it } from "vite-plus/test";

import { createApp } from "../src/app.ts";
import { errorSchema, issuedSchema, TOKEN_HEADER, verifiedSchema } from "../src/contract.ts";
import { parseEnv } from "../src/env.ts";
import { createKeyring } from "../src/keyring.ts";
import { MemorySecretStore, SecretAccessDenied, type SecretSource } from "../src/secret-source.ts";

const KEY = "do-not-leak-this-signing-key-0123456789abcdef";

function setup(source?: SecretSource) {
  const clock = { seconds: 1_000 };
  const logged: string[] = [];
  const store = new MemorySecretStore({ versionId: "v1", key: KEY, createdAt: new Date(0) });
  const app = createApp({
    stage: "test",
    tokenTtlSeconds: 300,
    now: () => clock.seconds,
    log: (entry) => logged.push(JSON.stringify(entry)),
    keyring: createKeyring({
      source: source ?? store,
      now: () => clock.seconds * 1000,
      ttlMs: 300_000,
      minRefreshMs: 30_000,
    }),
  });
  const verify = (token: string) => app.request("/verify", { headers: { [TOKEN_HEADER]: token } });
  return { app, clock, logged, verify };
}

describe("token API", () => {
  it("issues a token and accepts it back", async () => {
    const { app, verify } = setup();
    const issued = issuedSchema.parse(await (await app.request("/token?sub=alice")).json());
    expect(issued).toMatchObject({ keyVersion: "v1", expiresAt: 1_300 });

    const response = await verify(issued.token);
    expect(response.status).toBe(200);
    expect(verifiedSchema.parse(await response.json())).toEqual({
      subject: "alice",
      keyVersion: "v1",
      expiresAt: 1_300,
    });
  });

  it("stops accepting a token at its expiry", async () => {
    const { app, clock, verify } = setup();
    const { token } = issuedSchema.parse(await (await app.request("/token?sub=alice")).json());
    clock.seconds = 1_300;
    const response = await verify(token);
    expect(response.status).toBe(401);
    expect(errorSchema.parse(await response.json()).code).toBe("expired-token");
  });

  it("answers an unknown key version and a wrong signature the same way", async () => {
    const { app, verify } = setup();
    const { token } = issuedSchema.parse(await (await app.request("/token?sub=alice")).json());
    const [v, , exp, sub, signature] = token.split(".");
    const unknownVersion = await verify([v, "v9", exp, sub, signature].join("."));
    const wrongSignature = await verify([v, "v1", exp, sub, "AAAA"].join("."));
    expect(unknownVersion.status).toBe(401);
    expect(await unknownVersion.text()).toBe(await wrongSignature.text());
  });

  it("refuses a request without a token, and a subject it would not sign", async () => {
    const { app } = setup();
    expect((await app.request("/verify")).status).toBe(401);
    expect((await app.request("/token")).status).toBe(400);
    expect((await app.request("/token?sub=a%20b")).status).toBe(400);
  });

  it("answers 503 with retry-after while the function may not read its secret", async () => {
    const denied: SecretSource = {
      read: () => Promise.reject(new SecretAccessDenied("not allowed")),
    };
    const { app, logged } = setup(denied);
    const response = await app.request("/token?sub=alice");
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(errorSchema.parse(await response.json()).code).toBe("signing-key-unavailable");
    expect(logged.join("\n")).toContain("SecretAccessDenied");
    // /health does not need the secret, so it keeps answering.
    expect((await app.request("/health")).status).toBe(200);
  });

  it("never puts key material in a response or a log line", async () => {
    const { app, logged, verify } = setup();
    const bodies: string[] = [];
    const issued = await app.request("/token?sub=alice");
    bodies.push(await issued.clone().text());
    bodies.push(await (await verify(issuedSchema.parse(await issued.json()).token)).text());
    bodies.push(await (await verify("v1.v1.1.YQ.AAAA")).text());
    expect([...bodies, ...logged].join("\n")).not.toContain(KEY);
  });
});

describe("environment", () => {
  it("defaults to a throwaway key in memory, so local runs need no AWS", () => {
    expect(parseEnv({})).toMatchObject({ SECRET_SOURCE: "memory", TOKEN_TTL_SECONDS: 300 });
  });

  it("accepts where the secret is, and refuses anything that is not a secret ARN", () => {
    const arn = "arn:aws:secretsmanager:ap-northeast-1:111111111111:secret:SigningKey-AbCdEf";
    expect(parseEnv({ SECRET_SOURCE: "secretsmanager", SECRET_ID: arn })).toMatchObject({
      SECRET_ID: arn,
    });
    expect(() => parseEnv({ SECRET_SOURCE: "secretsmanager" })).toThrow("SECRET_ID");
    expect(() => parseEnv({ SECRET_SOURCE: "secretsmanager", SECRET_ID: KEY })).toThrow(
      "must be a secret ARN",
    );
  });
});
