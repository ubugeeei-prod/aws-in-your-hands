// Loads a bundle in a fresh Node.js process, the way a new execution environment does, and
// times the import. A laptop is not Lambda: these numbers compare bundles with each other
// on one machine and say nothing about milliseconds in AWS.

import { execFile, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import * as v from "valibot";

const execFileAsync = promisify(execFile);

// #region env
// Enough for the handler module to load. No table, no credentials, nothing to call.
const ENV = {
  ALLOWED_ORIGIN: "http://localhost:5173",
  NOTES_STORE: "memory",
  // The request line would share stdout with the result.
  LOG_LEVEL: "error",
  AWS_REGION: "ap-northeast-1",
  AWS_EC2_METADATA_DISABLED: "true",
};
// #endregion env

function run(script: string): string {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    timeout: 30_000,
    env: { PATH: process.env["PATH"] ?? "", ...ENV },
  });
  if (result.status !== 0) {
    throw new Error(`node exited with ${String(result.status)}:\n${result.stderr}`);
  }
  return result.stdout;
}

// #region load
const millisecondsSchema = v.pipe(v.number(), v.finite(), v.minValue(0));

/** Milliseconds spent importing `file`, once per fresh process. */
export function loadTimes(file: string, runs: number): number[] {
  const url = JSON.stringify(pathToFileURL(file).href);
  const script = `const t = performance.now(); await import(${url}); console.log(performance.now() - t);`;
  return Array.from({ length: runs }, () => v.parse(millisecondsSchema, Number(run(script))));
}

export function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? Number.NaN;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? Number.NaN) + upper) / 2;
}
// #endregion load

// #region invoke
const resultSchema = v.object({ statusCode: v.number(), body: v.string() });

/**
 * Imports the bundle in a new process and calls its handler once with a GET for `path`.
 * Asynchronous, so a test can keep a stand-in for DynamoDB answering meanwhile.
 */
export async function invoke(
  file: string,
  path: string,
  env: Record<string, string> = {},
): Promise<v.InferOutput<typeof resultSchema>> {
  const url = JSON.stringify(pathToFileURL(file).href);
  const event = {
    version: "2.0",
    rawPath: path,
    rawQueryString: "",
    headers: {},
    requestContext: { domainName: "api.test", http: { method: "GET", path } },
    isBase64Encoded: false,
  };
  const script = `const { handler } = await import(${url});
const result = await handler(${JSON.stringify(event)}, { getRemainingTimeInMillis: () => 10000 });
console.log(JSON.stringify(result));`;
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
    timeout: 30_000,
    env: { PATH: process.env["PATH"] ?? "", ...ENV, ...env },
  });
  return v.parse(resultSchema, JSON.parse(stdout));
}
// #endregion invoke
