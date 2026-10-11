import type { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { describe, expect, it } from "vite-plus/test";
import { SecretAccessDenied } from "../src/secret-source.ts";
import { createRotationApi, createSecretsManagerSource } from "../src/secrets-manager-source.ts";

const SECRET = "arn:aws:secretsmanager:ap-northeast-1:111111111111:secret:SigningKey-AbCdEf";
const KEY = "a-safe-made-up-value-0123456789-0123456789";

type Call = { name: string; input: Record<string, unknown> };

/** Stands in for the SDK client: records each command and answers from `respond`. */
function client(respond: (call: Call) => unknown) {
  const calls: Call[] = [];
  const send = async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const call = { name: command.constructor.name, input: command.input };
    calls.push(call);
    const answer = respond(call);
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  };
  return { calls, client: { send } as unknown as Pick<SecretsManagerClient, "send"> };
}
const serviceError = (name: string) => Object.assign(new Error(`${name}: details from the service`), { name });

describe("reading the secret", () => {
  it("asks for one staging label of one secret and returns the key with its version id", async () => {
    const { calls, client: sm } = client(() => ({ VersionId: "v2", SecretString: JSON.stringify({ key: KEY }) }));
    expect(await createSecretsManagerSource(sm, SECRET).read("AWSCURRENT")).toEqual({ versionId: "v2", key: KEY });
    expect(calls).toEqual([{ name: "GetSecretValueCommand", input: { SecretId: SECRET, VersionStage: "AWSCURRENT" } }]);
  });

  it("treats a missing AWSPREVIOUS as a secret that was never rotated", async () => {
    const { client: sm } = client(() => serviceError("ResourceNotFoundException"));
    const source = createSecretsManagerSource(sm, SECRET);
    expect(await source.read("AWSPREVIOUS")).toBeNull();
    // The same answer for AWSCURRENT means the secret itself is gone. That is not "no key".
    await expect(source.read("AWSCURRENT")).rejects.toMatchObject({ name: "ResourceNotFoundException" });
  });

  it("names a denial as a denial, so callers can tell it from an outage", async () => {
    const { client: sm } = client(() => serviceError("AccessDeniedException"));
    await expect(createSecretsManagerSource(sm, SECRET).read("AWSCURRENT")).rejects.toBeInstanceOf(SecretAccessDenied);
  });

  it.each([
    ["not JSON", KEY],
    ["no key field", JSON.stringify({ password: KEY })],
    ["a key too short to be one", JSON.stringify({ key: "short" })],
  ])("refuses a value that is %s, without repeating it", async (_, secretString) => {
    const { client: sm } = client(() => ({ VersionId: "v1", SecretString: secretString }));
    const error = await createSecretsManagerSource(sm, SECRET)
      .read("AWSCURRENT")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(KEY);
    expect(String(error)).not.toContain("short");
  });

  it("refuses a binary secret", async () => {
    const { client: sm } = client(() => ({ VersionId: "v1", SecretBinary: new Uint8Array([1]) }));
    await expect(createSecretsManagerSource(sm, SECRET).read("AWSCURRENT")).rejects.toThrow(
      "no VersionId or SecretString",
    );
  });
});

describe("the rotation calls", () => {
  it("sends the version id as the idempotency token and no staging labels", async () => {
    const { calls, client: sm } = client(() => ({}));
    await createRotationApi(sm, SECRET).put("5f0c0e0a-0000-4000-8000-000000000001", KEY);
    expect(calls).toEqual([
      {
        name: "PutSecretValueCommand",
        input: {
          SecretId: SECRET,
          ClientRequestToken: "5f0c0e0a-0000-4000-8000-000000000001",
          SecretString: JSON.stringify({ key: KEY }),
        },
      },
    ]);
  });

  it("lists versions with their labels and creation times", async () => {
    const created = new Date("2026-10-01T00:00:00Z");
    const { client: sm } = client(() => ({
      Versions: [
        { VersionId: "v2", VersionStages: ["AWSCURRENT"], CreatedDate: created },
        { VersionId: "v1", VersionStages: ["AWSPREVIOUS"], CreatedDate: created },
      ],
    }));
    expect(await createRotationApi(sm, SECRET).versions()).toEqual([
      { versionId: "v2", stages: ["AWSCURRENT"], createdAt: created },
      { versionId: "v1", stages: ["AWSPREVIOUS"], createdAt: created },
    ]);
  });
});
