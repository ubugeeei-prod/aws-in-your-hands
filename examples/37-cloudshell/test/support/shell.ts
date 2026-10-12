import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSync } from "esbuild";

import { bundleOptions } from "../../scripts/bundle.ts";
import type { FakeVersion } from "./fixtures.ts";

// A directory that looks like a shell with `aws` on PATH, where `aws` is the fake.
// The bundle is built once into it and run with the Node.js that runs the tests.

const root = fileURLToPath(new URL("../..", import.meta.url));
const fake = fileURLToPath(new URL("./fake-aws.ts", import.meta.url));

export type Shell = {
  bundle: string;
  run(
    args: string[],
    env?: Record<string, string>,
  ): { status: number; stdout: string; stderr: string };
  calls(): string[][];
  bucket(): FakeVersion[];
};

export function shellWith(objects: FakeVersion[]): Shell {
  const directory = mkdtempSync(join(tmpdir(), "aih-cloudshell-"));
  const bundle = join(directory, "aih-cloudshell.mjs");
  buildSync({ ...bundleOptions(bundle), absWorkingDir: root });

  const bin = join(directory, "bin");
  const log = join(directory, "calls.log");
  const bucketFile = join(directory, "bucket.json");
  writeFileSync(log, "");
  writeFileSync(bucketFile, JSON.stringify(objects));
  mkdirSync(bin);
  writeFileSync(join(bin, "aws"), `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`);
  chmodSync(join(bin, "aws"), 0o755);

  return {
    bundle,
    run(args, env = {}) {
      const result = spawnSync(process.execPath, [bundle, ...args], {
        encoding: "utf8",
        env: {
          PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
          AIH_FAKE_LOG: log,
          AIH_FAKE_BUCKET: bucketFile,
          ...env,
        },
      });
      return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
    },
    calls: () =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as string[]),
    bucket: () => JSON.parse(readFileSync(bucketFile, "utf8")) as FakeVersion[],
  };
}
