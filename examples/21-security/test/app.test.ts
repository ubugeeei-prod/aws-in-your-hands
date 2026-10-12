import * as v from "valibot";
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
  const get = async (path: string, headers: Record<string, string> = {}) =>
    app(new Request(`http://api.test${path}`, { headers }));
  const verify = (token: string) => get("/verify", { [TOKEN_HEADER]: token });
  return { app, clock, get, logged, verify };
}

describe("token API", () => {
  it("issues a token and accepts it back", async () => {
    const { get, verify } = setup();
    const issued = v.parse(issuedSchema, await (await get("/token?sub=alice")).json());
    expect(issued).toMatchObject({ keyVersion: "v1", expiresAt: 1_300 });

    const response = await verify(issued.token);
    expect(response.status).toBe(200);
    expect(v.parse(verifiedSchema, await response.json())).toEqual({
      subject: "alice",
      keyVersion: "v1",
      expiresAt: 1_300,
    });
  });

  it("stops accepting a token at its expiry", async () => {
    const { get, clock, verify } = setup();
    const { token } = v.parse(issuedSchema, await (await get("/token?sub=alice")).json());
    clock.seconds = 1_300;
    const response = await verify(token);
    expect(response.status).toBe(401);
    expect(v.parse(errorSchema, await response.json()).code).toBe("expired-token");
  });

  it("answers an unknown key version and a wrong signature the same way", async () => {
    const { get, verify } = setup();
    const { token } = v.parse(issuedSchema, await (await get("/token?sub=alice")).json());
    const [format, , exp, sub, signature] = token.split(".");
    const unknownVersion = await verify([format, "v9", exp, sub, signature].join("."));
    const wrongSignature = await verify([format, "v1", exp, sub, "AAAA"].join("."));
    expect(unknownVersion.status).toBe(401);
    expect(await unknownVersion.text()).toBe(await wrongSignature.text());
  });

  it("refuses a request without a token, and a subject it would not sign", async () => {
    const { get } = setup();
    expect((await get("/verify")).status).toBe(401);
    expect((await get("/token")).status).toBe(400);
    expect((await get("/token?sub=a%20b")).status).toBe(400);
  });

  it("refuses the hostile forms of a subject: repeated, over-long, encoded separators", async () => {
    const { get } = setup();
    // The first value is the one read, and the token format's separator is not in the pattern.
    expect((await get("/token?sub=a.b%2Ec&sub=alice")).status).toBe(200);
    for (const sub of ["", "a".repeat(65), "a%2Fb", "a%0Ab", "a%00", "%zz", "a+b", "alice%0A"]) {
      expect((await get(`/token?sub=${sub}`)).status, sub).toBe(400);
    }
    expect((await get(`/token?sub=${"a".repeat(64)}`)).status).toBe(200);
  });

  it("answers only GET on the three paths; there is no implicit HEAD", async () => {
    const { app } = setup();
    for (const [method, path] of [
      ["HEAD", "/health"],
      ["POST", "/token?sub=alice"],
      ["GET", "/tokens"],
      ["GET", "/verify/"],
    ] as const) {
      const response = await app(new Request(`http://api.test${path}`, { method }));
      expect(response.status, `${method} ${path}`).toBe(404);
    }
  });

  it("answers 503 with retry-after while the function may not read its secret", async () => {
    const denied: SecretSource = {
      read: () => Promise.reject(new SecretAccessDenied("not allowed")),
    };
    const { get, logged } = setup(denied);
    const response = await get("/token?sub=alice");
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(v.parse(errorSchema, await response.json()).code).toBe("signing-key-unavailable");
    expect(logged.join("\n")).toContain("SecretAccessDenied");
    // The answer says that the key is unavailable, and nothing the error carried.
    expect(logged.join("\n")).not.toContain("not allowed");
    // /health does not need the secret, so it keeps answering.
    expect((await get("/health")).status).toBe(200);
  });

  it("never puts key material in a response or a log line", async () => {
    const { get, logged, verify } = setup();
    const bodies: string[] = [];
    const issued = await get("/token?sub=alice");
    bodies.push(await issued.clone().text());
    bodies.push(await (await verify(v.parse(issuedSchema, await issued.json()).token)).text());
    bodies.push(await (await verify("v1.v1.1.YQ.AAAA")).text());
    expect([...bodies, ...logged].join("\n")).not.toContain(KEY);
  });
});

describe("contract", () => {
  it("refuses an expiry that is not an exact whole number", () => {
    const issued = { token: "t", keyVersion: "v1" };
    for (const expiresAt of [Infinity, Number.NaN, 1.5, 2 ** 53, "1300"]) {
      expect(v.safeParse(issuedSchema, { ...issued, expiresAt }).success, String(expiresAt)).toBe(
        false,
      );
    }
    expect(v.safeParse(issuedSchema, { ...issued, expiresAt: 1_300 }).success).toBe(true);
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
    expect(() => parseEnv({ SECRET_SOURCE: "s3" })).toThrow("SECRET_SOURCE");
    expect(() => parseEnv({ SECRET_SOURCE: "secretsmanager" })).toThrow("SECRET_ID");
    expect(() => parseEnv({ SECRET_SOURCE: "secretsmanager", SECRET_ID: KEY })).toThrow(
      "must be a secret ARN",
    );
  });

  it.each(["0", "-1", "2.5", "", "abc", "Infinity", "9007199254740993"])(
    "refuses TOKEN_TTL_SECONDS=%j instead of signing tokens with it",
    (TOKEN_TTL_SECONDS) => {
      expect(() => parseEnv({ TOKEN_TTL_SECONDS })).toThrow("TOKEN_TTL_SECONDS");
    },
  );

  it("reads a duration as Number() does", () => {
    expect(parseEnv({ TOKEN_TTL_SECONDS: "60", KEY_CACHE_SECONDS: " 3e2 " })).toMatchObject({
      TOKEN_TTL_SECONDS: 60,
      KEY_CACHE_SECONDS: 300,
    });
  });
});
