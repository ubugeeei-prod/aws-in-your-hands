import { readFileSync } from "node:fs";

import { type MicroVmConfig, parseMicroVmConfig, WALKTHROUGH_CONFIG } from "./config.ts";

export type CliArgs = {
  config: MicroVmConfig;
  socketPath: string;
  probeUrl: string;
  snapshot: boolean;
};

/** The quickstart's socket path, and the address its rootfs derives from the MAC 06:00:AC:10:00:02. */
export const DEFAULTS = {
  socketPath: "/tmp/firecracker.socket",
  probeUrl: "http://172.16.0.2:8080/health",
} as const;

// #region args
/** `[config.json] [--socket path] [--probe url] [--snapshot]`. With no file: the walkthrough's configuration. */
export function parseArgs(
  argv: readonly string[],
  read: (file: string) => string = (file) => readFileSync(file, "utf8"),
): CliArgs {
  let file: string | undefined;
  let socketPath: string = DEFAULTS.socketPath;
  let probeUrl: string = DEFAULTS.probeUrl;
  let snapshot = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    const value = () => {
      const next = argv[(index += 1)];
      if (next === undefined) {
        throw new Error(`${argument} needs a value`);
      }
      return next;
    };
    if (argument === "--socket") {
      socketPath = value();
    } else if (argument === "--probe") {
      probeUrl = new URL(value()).href;
    } else if (argument === "--snapshot") {
      snapshot = true;
    } else if (argument.startsWith("--") || file !== undefined) {
      throw new Error(`unexpected argument "${argument}"`);
    } else {
      file = argument;
    }
  }
  const input: unknown = file === undefined ? WALKTHROUGH_CONFIG : JSON.parse(read(file));
  return { config: parseMicroVmConfig(input), socketPath, probeUrl, snapshot };
}
// #endregion args
