// vp run agentcore:bundle:check
//   node scripts/check-bundle.ts
//
// Builds app.js exactly as the stack does, into an empty directory outside this package (the
// archive has no package.json either, so Node.js loads the file as CommonJS in both places),
// starts it with plain Node.js and environment variables, and asks it the questions that need
// no AWS call: is it healthy, and does it turn away a request without a token. No AWS, no charge.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as v from "valibot";

import { bundleAgent, ENTRY_FILE } from "../infra/lib/bundle.ts";
import { errorSchema, pingSchema, SESSION_HEADER } from "../src/contract.ts";
import { newSessionId } from "../src/session-id.ts";

/** A port nothing is listening on, chosen by the operating system. */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address !== null
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });

const out = mkdtempSync(join(tmpdir(), "aih-agent-"));
bundleAgent(out);
const file = join(out, ENTRY_FILE);
console.log(`${ENTRY_FILE}: ${(statSync(file).size / 1024).toFixed(1)} KiB`);

const port = await freePort();
const child = spawn(process.execPath, [file], {
  env: {
    PATH: process.env["PATH"],
    PORT: String(port),
    AI_BACKEND: "bedrock",
    BEDROCK_MODEL_ID: "jp.amazon.nova-2-lite-v1:0",
    // Names only. Nothing below makes the agent use them.
    NOTES_TABLE_NAME: "not-a-table",
    MEMORY_ID: "not-a-memory",
    JWT_ISSUER: "https://issuer.invalid",
    JWT_CLIENT_ID: "not-a-client",
  },
  stdio: ["ignore", "pipe", "inherit"],
});

try {
  await new Promise<void>((resolve, reject) => {
    child.stdout.once("data", () => resolve());
    child.once("exit", (code) =>
      reject(new Error(`the bundle exited with ${code} before listening`)),
    );
  });
  const base = `http://127.0.0.1:${port}`;

  const ping = await fetch(`${base}/ping`);
  const health = v.parse(pingSchema, await ping.json());
  if (ping.status !== 200 || health.status !== "Healthy") {
    throw new Error(`GET /ping answered ${ping.status} ${JSON.stringify(health)}`);
  }
  console.log("ok   GET /ping answers 200 Healthy");

  const stranger = await fetch(`${base}/invocations`, {
    method: "POST",
    headers: { [SESSION_HEADER]: newSessionId("nobody") },
    body: JSON.stringify({ prompt: "hello" }),
  });
  const refusal = v.parse(errorSchema, await stranger.json());
  if (stranger.status !== 401 || refusal.error.code !== "unauthorized") {
    throw new Error(`an invocation without a token answered ${stranger.status}`);
  }
  console.log("ok   POST /invocations without a token answers 401");
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  rmSync(out, { recursive: true, force: true });
}
