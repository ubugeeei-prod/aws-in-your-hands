import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

import * as v from "valibot";

import type { Deployment } from "./definition.ts";

// #region installed
// The package is CommonJS and ships no types. This is what its lib/main.js exports.
const installedSchema = v.object({
  default: v.pipe(v.string(), v.minLength(1)),
  version: v.string(),
  compatibilityDate: v.string(),
});

/** The workerd the npm package brought for this machine: where its binary is, and which one it is. */
export const INSTALLED = v.parse(installedSchema, createRequire(import.meta.url)("workerd"));
export const WORKERD_BINARY: string = INSTALLED.default;
// #endregion installed

const listenSchema = v.object({
  event: v.literal("listen"),
  socket: v.string(),
  port: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65_535)),
});

export type Running = {
  /** Base URL of each socket, by socket name. */
  url: Record<string, string>;
  /** Every line the workers have written to standard output so far. */
  lines: string[];
  /** What workerd itself wrote to standard error. */
  errors: string[];
  process: ChildProcess;
  /** SIGTERM, then waits for the exit. Resolves with the exit code. */
  stop(): Promise<number | null>;
};

const collect = (stream: Readable | null, into: string[]): void => {
  if (stream !== null) {
    createInterface({ input: stream }).on("line", (line) => into.push(line));
  }
};

// #region start
/**
 * Starts workerd on loopback ports the kernel picks, and waits until every socket listens.
 * workerd reports each port as a JSON line on the descriptor named by --control-fd.
 */
export async function startWorkerd(
  configPath: string,
  deployment: Deployment,
  environment: Record<string, string> = {},
): Promise<Running> {
  const names = deployment.sockets.map((socket) => socket.name);
  const child = spawn(
    WORKERD_BINARY,
    [
      "serve",
      configPath,
      "--control-fd=3",
      ...names.map((name) => `--socket-addr=${name}=127.0.0.1:0`),
    ],
    { stdio: ["ignore", "pipe", "pipe", "pipe"], env: environment },
  );
  const lines: string[] = [];
  const errors: string[] = [];
  collect(child.stdout, lines);
  collect(child.stderr, errors);
  const exited = once(child, "exit") as Promise<[number | null]>;

  const url: Record<string, string> = {};
  const control = createInterface({ input: child.stdio[3] as Readable });
  const listening = (async () => {
    for await (const line of control) {
      const message = v.safeParse(listenSchema, JSON.parse(line));
      if (message.success) {
        url[message.output.socket] = `http://127.0.0.1:${message.output.port}`;
      }
      if (names.every((name) => name in url)) {
        return;
      }
    }
    throw new Error(`workerd exited before it listened:\n${errors.join("\n")}`);
  })();
  await Promise.race([
    listening,
    exited.then(([code]) => {
      throw new Error(`workerd exited with ${code} before it listened:\n${errors.join("\n")}`);
    }),
  ]);

  return {
    url,
    lines,
    errors,
    process: child,
    async stop() {
      child.kill("SIGTERM");
      const [code] = await exited;
      return code;
    },
  };
}
// #endregion start
