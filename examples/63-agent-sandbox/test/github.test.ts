import { createVerify, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import {
  appJwt,
  type GithubApp,
  pullRequest,
  readToken,
  TOKEN_PERMISSIONS,
  tokenRequest,
} from "../src/github.ts";

// A throwaway key made for this run. No real GitHub App is involved, and nothing is sent.
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const app: GithubApp = {
  clientId: "Iv23liTESTCLIENT",
  installationId: 4242,
  owner: "acme",
  privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
const NOW = new Date("2026-10-13T03:00:00Z");
const DEADLINE = new Date("2026-10-13T03:30:00Z");
const decode = (part: string | undefined) =>
  JSON.parse(Buffer.from(part ?? "", "base64url").toString()) as Record<string, unknown>;

describe("the app's JWT", () => {
  const [header, payload, signature] = appJwt(app, NOW).split(".");

  it("is RS256, back-dated a minute, and good for under ten minutes", () => {
    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = decode(payload);
    const now = NOW.getTime() / 1000;
    expect(claims).toEqual({ iat: now - 60, exp: now + 540, iss: app.clientId });
    expect(Number(claims["exp"]) - now).toBeLessThanOrEqual(600);
  });

  it("verifies with the public key", () => {
    const verified = createVerify("RSA-SHA256")
      .update(`${header}.${payload}`)
      .verify(keys.publicKey, Buffer.from(signature ?? "", "base64url"));
    expect(verified).toBe(true);
  });
});

describe("the installation token", () => {
  it("is asked for one repository and two permissions", () => {
    const request = tokenRequest(app, "acme/notes", NOW);
    expect(request?.url).toBe("https://api.github.com/app/installations/4242/access_tokens");
    expect(JSON.parse(request?.body ?? "{}")).toEqual({
      repositories: ["notes"],
      permissions: { contents: "write", pull_requests: "write" },
    });
    expect(request?.headers["authorization"]).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it("is not asked for at all when the repository belongs to another owner", () => {
    expect(tokenRequest(app, "other/notes", NOW)).toBeUndefined();
  });

  const answer = (extra: Record<string, unknown> = {}) => ({
    token: "ghs_example",
    expires_at: "2026-10-13T04:00:00Z",
    permissions: { ...TOKEN_PERMISSIONS, metadata: "read" },
    repository_selection: "selected",
    repositories: [{ full_name: "acme/notes" }],
    ...extra,
  });

  it("is accepted when it is exactly what was asked for", () => {
    expect(readToken(answer(), "acme/notes", DEADLINE).token).toBe("ghs_example");
  });

  it("is refused when it is wider, or would die before the task does", () => {
    const wider = [
      answer({ permissions: { ...TOKEN_PERMISSIONS, administration: "write" } }),
      answer({ repositories: [{ full_name: "acme/notes" }, { full_name: "acme/web" }] }),
      answer({ repositories: undefined }),
      answer({ repositories: [{ full_name: "acme/web" }] }),
      answer({ expires_at: "2026-10-13T03:30:00Z" }),
      answer({ token: "" }),
    ];
    for (const body of wider) {
      expect(() => readToken(body, "acme/notes", DEADLINE)).toThrow();
    }
  });
});

describe("the pull request", () => {
  it("goes from the work branch to the base branch of the same repository", () => {
    const request = pullRequest(
      { repository: "acme/notes", head: "agent/x", base: "main", title: "t", body: "b" },
      "ghs_example",
    );
    expect(request.url).toBe("https://api.github.com/repos/acme/notes/pulls");
    expect(JSON.parse(request.body)).toEqual({
      title: "t",
      head: "agent/x",
      base: "main",
      body: "b",
    });
  });
});
