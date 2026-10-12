import { createVerify, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import { appJwt, gitHubApp, GitHubError } from "../src/github.ts";

// A key made for this test run. No real app's key is in the repository.
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const NOW = 1_800_000_000;
const decode = (part: string | undefined) =>
  JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8")) as Record<string, unknown>;

type Call = { url: string; method: string; headers: Headers; body: unknown };

function fakeApi(answers: Record<string, { status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fetchFake: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const answer = answers[`${method} ${new URL(url).pathname}`] ?? { status: 404 };
    return answer.status === 204
      ? new Response(null, { status: 204 })
      : Response.json(answer.body ?? {}, { status: answer.status });
  };
  const github = gitHubApp({
    clientId: "Iv23example",
    privateKey: async () => privateKey,
    runnerGroupId: 1,
    labels: ["aih-fargate"],
    fetch: fetchFake,
    now: () => NOW,
  })(50000001, "example-org/notes");
  return { calls, github };
}

const token = {
  "POST /app/installations/50000001/access_tokens": { status: 201, body: { token: "ghs_test" } },
};

describe("the app's JWT", () => {
  it("is signed with RS256 and lives less than GitHub's ten minutes", () => {
    const [header, claims, signature] = appJwt("Iv23example", privateKey, NOW).split(".");
    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(claims)).toEqual({ iat: NOW - 60, exp: NOW + 540, iss: "Iv23example" });
    const verified = createVerify("RSA-SHA256")
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature ?? "", "base64url"));
    expect(verified).toBe(true);
  });

  it("accepts a key in PKCS#1 as well as PKCS#8", () => {
    const pkcs1 = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    expect(pkcs1.privateKey).toContain("BEGIN RSA PRIVATE KEY");
    expect(appJwt("Iv23example", pkcs1.privateKey, NOW).split(".")).toHaveLength(3);
  });
});

describe("the GitHub client", () => {
  it("asks for a token for one repository with two permissions, once per delivery", async () => {
    const { calls, github } = fakeApi({
      ...token,
      "GET /repos/example-org/notes/actions/runs/7": {
        status: 200,
        body: {
          event: "push",
          repository: { full_name: "example-org/notes" },
          head_repository: { full_name: "example-org/notes" },
        },
      },
      "POST /repos/example-org/notes/actions/runners/generate-jitconfig": {
        status: 201,
        body: { runner: { id: 23, name: "aih-1-a" }, encoded_jit_config: "abc" },
      },
    });
    await github.run(7);
    expect(await github.createRunner("aih-1-a")).toEqual({ runnerId: 23, encodedJitConfig: "abc" });

    const tokenCalls = calls.filter((call) => call.url.endsWith("/access_tokens"));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]?.body).toEqual({
      repositories: ["notes"],
      permissions: { administration: "write", actions: "read" },
    });
    expect(tokenCalls[0]?.headers.get("authorization")).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    const jit = calls.at(-1);
    expect(jit?.headers.get("authorization")).toBe("Bearer ghs_test");
    expect(jit?.headers.get("x-github-api-version")).toBe("2022-11-28");
    expect(jit?.body).toEqual({ name: "aih-1-a", runner_group_id: 1, labels: ["aih-fargate"] });
  });

  it("removes a runner by its id", async () => {
    const { calls, github } = fakeApi({
      ...token,
      "DELETE /repos/example-org/notes/actions/runners/23": { status: 204 },
    });
    await github.removeRunner(23);
    expect(calls.at(-1)?.method).toBe("DELETE");
  });

  it("throws on any answer that is not a success, with the status", async () => {
    const { github } = fakeApi({
      ...token,
      "POST /repos/example-org/notes/actions/runners/generate-jitconfig": { status: 409 },
    });
    await expect(github.createRunner("aih-1-a")).rejects.toMatchObject({
      name: "GitHubError",
      status: 409,
    });
    expect(new GitHubError("x", 409).message).not.toContain("ghs_");
  });

  it("refuses an answer without a registration", async () => {
    const { github } = fakeApi({
      ...token,
      "POST /repos/example-org/notes/actions/runners/generate-jitconfig": {
        status: 201,
        body: { runner: { id: 23 }, encoded_jit_config: "" },
      },
    });
    await expect(github.createRunner("aih-1-a")).rejects.toThrow();
  });
});
