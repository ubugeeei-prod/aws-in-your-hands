import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { PINNED_DEFAULTS, PINNED_DEFAULTS_2026, sdkDefaultsSchema } from "../src/defaults.ts";

const run = promisify(execFile);
const empty = join(mkdtempSync(join(tmpdir(), "aih-48-defaults-")), "empty");
writeFileSync(empty, "");

// The switch is read once, when the SDK's modules load. Each case therefore gets its own
// process, started with nothing but PATH, empty shared files, and the variables under test.
async function defaultsWith(env: Record<string, string>) {
  const { stdout } = await run(process.execPath, ["scripts/defaults.ts"], {
    cwd: join(import.meta.dirname, ".."),
    env: {
      PATH: process.env.PATH,
      AWS_CONFIG_FILE: empty,
      AWS_SHARED_CREDENTIALS_FILE: empty,
      ...env,
    },
  });
  return v.parse(sdkDefaultsSchema, JSON.parse(stdout));
}

describe("what the pinned SDK does when nothing is configured", () => {
  it("is the behaviour from before 2026", async () => {
    expect(await defaultsWith({})).toEqual(PINNED_DEFAULTS);
  });

  it("has no timeout of any kind, and keeps connections open", async () => {
    const { http } = await defaultsWith({});

    expect(http).toMatchObject({
      connectionTimeoutMs: null,
      requestTimeoutMs: null,
      socketTimeoutMs: null,
    });
    expect(http.keepAlive).toBe(true);
  });
});

describe("the 2026 retry behaviour", () => {
  it("is switched on by AWS_NEW_RETRIES_2026=true in the environment", async () => {
    expect(await defaultsWith({ AWS_NEW_RETRIES_2026: "true" })).toEqual(PINNED_DEFAULTS_2026);
  });

  it("is switched on by SMITHY_NEW_RETRIES_2026=true as well", async () => {
    expect(await defaultsWith({ SMITHY_NEW_RETRIES_2026: "true" })).toEqual(PINNED_DEFAULTS_2026);
  });

  it("stays off for any other value", async () => {
    expect(await defaultsWith({ AWS_NEW_RETRIES_2026: "1" })).toEqual(PINNED_DEFAULTS);
    expect(await defaultsWith({ AWS_NEW_RETRIES_2026: "TRUE" })).toEqual(PINNED_DEFAULTS);
  });

  it("gives DynamoDB a fourth attempt, and no other client here", async () => {
    const { maxAttempts } = await defaultsWith({ AWS_NEW_RETRIES_2026: "true" });

    expect(maxAttempts).toEqual({ dynamodb: 4, s3: 3, constant: 3 });
  });

  it("yields to AWS_MAX_ATTEMPTS", async () => {
    const { maxAttempts } = await defaultsWith({
      AWS_NEW_RETRIES_2026: "true",
      AWS_MAX_ATTEMPTS: "2",
    });

    expect(maxAttempts).toMatchObject({ dynamodb: 2, s3: 2 });
  });
});
