import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundleWorker } from "../src/bundle.ts";
import { renderConfig } from "../src/capnp.ts";
import { type DeploymentInput, parseDeployment } from "../src/definition.ts";
import { BUNDLES } from "../src/deployments.ts";
import { type Running, startWorkerd, WORKERD_BINARY } from "../src/runtime.ts";

/** False where the binary cannot start: an unsupported platform, or a libc older than it asks for. */
export const workerdStarts = (): boolean =>
  spawnSync(WORKERD_BINARY, ["--version"], { stdio: "ignore" }).status === 0;

const here = new URL("..", import.meta.url).pathname;

/** A directory with every bundle in it, built once per test file. */
export async function bundles(): Promise<{ directory: string; remove: () => void }> {
  const directory = mkdtempSync(join(tmpdir(), "aih-isolates-"));
  for (const { entry, module } of Object.values(BUNDLES)) {
    await bundleWorker(join(here, entry), join(directory, module));
  }
  return { directory, remove: () => rmSync(directory, { recursive: true, force: true }) };
}

/** Writes the configuration next to the bundles and starts the real workerd on it. */
export function serve(
  directory: string,
  input: DeploymentInput,
  environment: Record<string, string> = {},
): Promise<Running> {
  const deployment = parseDeployment(input);
  const configPath = join(directory, `config-${process.hrtime.bigint()}.capnp`);
  writeFileSync(configPath, renderConfig(deployment));
  return startWorkerd(configPath, deployment, environment);
}

export type Held = {
  /** Sends the rest of the body. Resolves with the answer. */
  finish(): Promise<{ status: number; requestId: string | undefined; body: string }>;
};

/**
 * Starts a POST and stops halfway through its body. The worker has the request and is
 * waiting for the rest: the place where a real handler waits for a database.
 */
export function heldPost(url: string, body: string): Held {
  const request = http.request(url, { method: "POST" });
  const answered = new Promise<Awaited<ReturnType<Held["finish"]>>>((resolve, reject) => {
    request.on("error", reject);
    request.on("response", (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (text += chunk));
      response.on("end", () =>
        resolve({
          status: response.statusCode ?? 0,
          requestId: response.headers["x-request-id"]?.toString(),
          body: text,
        }),
      );
    });
  });
  const half = Math.floor(body.length / 2);
  // No content-length, so Node.js sends the body in chunks and the first one goes out now.
  request.write(body.slice(0, half));
  return {
    finish() {
      request.end(body.slice(half));
      return answered;
    },
  };
}

/** Waits until `lines` has a line that `matches`, checking as often as the event loop turns. */
export async function waitForLine(
  lines: string[],
  matches: (line: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    for (const line of lines) {
      const entry = parseLine(line);
      if (entry !== undefined && matches(entry)) {
        return entry;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`no such line in:\n${lines.join("\n")}`);
}

function parseLine(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
